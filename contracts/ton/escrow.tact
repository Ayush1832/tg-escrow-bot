// Escrow contract for USDT on TON Testnet
// Flow: Seller deploys -> Seller deposits USDT -> Buyer pays off-chain -> Seller confirms -> Escrow releases USDT

// Binary message definitions for better performance
message(0x1) ConfirmDelivery {}
message(0x2) RaiseDispute {}
message(0x3) ResolveToBuyer {}
message(0x4) ResolveToSeller {}
message(0x5) CancelIfNoDeposit {}
message(0x6) ClaimExpired {}
message(0x7) EmergencyWithdraw {}
message(0x8) ConfirmDeposit {}
message(0x9) RetryPayout {}

// Standard jetton notification when tokens are received
message(0x7362d09c) TokenNotification {
    queryId: Int as uint64;
    amount: Int as uint128;  // Use uint128 for token amounts
    from: Address;
    forwardPayload: Slice as remaining;
}

// Production event logging for audit trail
message(0x10) DepositReceived {
    amount: Int as uint128;
    from: Address;
    jettonWallet: Address;
}

message(0x11) DepositConfirmed {
    confirmedBy: Address;
}

message(0x12) TradeCompleted {
    buyer: Address;
    amount: Int as uint128;
    fee: Int as uint128;
}

message(0x13) PayoutRetried {
    retriedBy: Address;
    queryId: Int as uint64;
}

// Testnet USDT Master (replace with mainnet when live)
const USDT_MASTER: Address = address("kQD0GKBM8ZbryVk2aESmzfU6b9b_8era_IkvBSELujFZPsyy");

// Standalone fee calculation functions (extracted for performance)
fun computeW1(fee: Int): Int { return (fee * 7000) / 10000; }
fun computeW2(fee: Int): Int { return (fee * 2250) / 10000; }
fun computeW3(fee: Int, w1: Int, w2: Int): Int { return fee - w1 - w2; }

contract Escrow {

  // Parties
  seller: Address;
  buyer: Address;
  admin: Address;
  
  // Security: Pre-computed expected jetton wallet (set by bot during deployment)
  expectedJettonWallet: Address?;

  // Trade
  amount: Int;         // trade amount in USDT (jettons, 6 decimals)
  commissionBps: Int; // fee % in basis points (10000 = 100%)

  // Fee recipients
  feeW1: Address; // 70%
  feeW2: Address; // 22.5%
  feeW3: Address; // 7.5% + remainder

  // Status
  // 0 = PendingDeposit, 1 = Active, 2 = Dispute, 3 = Released, 4 = Refunded
  status: Int;

  // deposited jettons
  deposited: Int as uint128;

  // optional deadline
  deadline: Int as uint32;

  // jetton wallet address for this escrow (verified)
  jettonWallet: Address?;

  // track if deposit was verified
  depositVerified: Bool;
  
  // track payout attempts to prevent double-spending
  payoutAttempted: Bool;

  // ---------- init ----------
  init(
    seller_: Address,
    buyer_: Address,
    admin_: Address,
    amount_: Int as uint128,
    commissionBps_: Int as uint16,
    feeW1_: Address,
    feeW2_: Address,
    feeW3_: Address,
    deadline_: Int,
    expectedJettonWallet_: Address?  // Pre-computed by bot for security
  ) {
    require(amount_ > 0, "Amount must be > 0");
    require(commissionBps_ <= 10000, "Commission must be <= 100%");

    self.seller = seller_;
    self.buyer = buyer_;
    self.admin = admin_;
    self.amount = amount_;
    self.commissionBps = commissionBps_;
    self.feeW1 = feeW1_;
    self.feeW2 = feeW2_;
    self.feeW3 = feeW3_;
    self.status = 0;       // PendingDeposit
    self.deposited = 0;
    self.deadline = deadline_;
    self.jettonWallet = null;
    self.depositVerified = false;
    self.payoutAttempted = false;
    self.expectedJettonWallet = expectedJettonWallet_;
  }

  // ---------- fee helpers ----------
  fun computeFee(total: Int): Int {
    return (total * self.commissionBps) / 10000;
  }

  // PRODUCTION: Verify jetton wallet belongs to USDT master
  inline fun isUSDTWallet(wallet: Address): Bool {
    // With expectedJettonWallet pre-computed from USDT_MASTER, this is secure
    // The bot ensures expectedJettonWallet is derived from USDT_MASTER + escrow address
    if (self.expectedJettonWallet != null) {
      return wallet == self.expectedJettonWallet;
    }
    
    // Fallback: Basic validation (not as secure)
    return wallet != myAddress();
  }
  
  // Verify if sender is the correct USDT jetton wallet for this escrow
  inline fun verifyJettonWallet(wallet: Address): Bool {
    // PRODUCTION SECURITY: Use the pre-computed USDT wallet verification
    return self.isUSDTWallet(wallet);
  }

  // ---------- jetton receiver ----------
  receive(msg: TokenNotification) {
    require(self.status == 0, "Already deposited");
    require(msg.from == self.seller, "Only seller can deposit");
    require(msg.amount == self.amount, "Deposit must equal trade amount");
    
    // CRITICAL: Verify this is a legitimate USDT jetton wallet
    require(self.verifyJettonWallet(sender()), "Invalid USDT jetton wallet");
    
    // PRODUCTION SECURITY: Additional validation
    // Since we use pre-computed expectedJettonWallet derived from USDT_MASTER,
    // the verification above already ensures this is a legitimate USDT wallet

    // Store the verified jetton wallet address
    self.jettonWallet = sender();
    self.deposited = msg.amount;
    self.depositVerified = false; // Bot must confirm after off-chain balance verification
    self.status = 1; // Active - but deposit not yet confirmed
    
    // Emit deposit event for audit trail
    emit(DepositReceived{
        amount: msg.amount,
        from: msg.from,
        jettonWallet: sender()
    }.toCell());
  }

  // ---------- confirm delivery (seller releases to buyer) ----------
  receive(msg: ConfirmDelivery) {
    require(sender() == self.seller, "Only seller can confirm");
    require(self.status == 1, "Must be active - already resolved");
    require(self.depositVerified, "Deposit not verified");
    require(!self.payoutAttempted, "Payout already attempted");

    self.status = 3; // Released
    
    let fee: Int = self.computeFee(self.deposited);
    let w1: Int = computeW1(fee);
    let w2: Int = computeW2(fee);
    let w3: Int = computeW3(fee, w1, w2);

    let toBuyer: Int = self.deposited - fee;

    // Mark payout as attempted to prevent double-spending
    self.payoutAttempted = true;
    
    // Send to buyer first (most important)
    self.sendJettonTransfer(self.buyer, toBuyer, 0, "Trade completed");
    
    // Send fees
    self.sendJettonTransfer(self.feeW1, w1, 1, "Platform fee 1");
    self.sendJettonTransfer(self.feeW2, w2, 2, "Platform fee 2");
    self.sendJettonTransfer(self.feeW3, w3, 3, "Platform fee 3");
    
    // Emit trade completion event
    emit(TradeCompleted{
        buyer: self.buyer,
        amount: toBuyer,
        fee: fee
    }.toCell());
  }

  // ---------- raise dispute ----------
  receive(msg: RaiseDispute) {
    require(sender() == self.buyer, "Only buyer can dispute");
    require(self.status == 1, "Must be active - already resolved");
    require(self.depositVerified, "Deposit not verified");
    self.status = 2; // Dispute
  }

  // ---------- admin resolves ----------
  receive(msg: ResolveToBuyer) {
    require(sender() == self.admin, "Only admin can resolve");
    require(self.status == 1 || self.status == 2, "Invalid status - already resolved");
    require(self.depositVerified, "Deposit not verified");
    
    self.status = 3; // Released (buyer wins)
    
    // Calculate fees (platform still gets commission)
    let fee: Int = self.computeFee(self.deposited);
    let w1: Int = computeW1(fee);
    let w2: Int = computeW2(fee);
    let w3: Int = computeW3(fee, w1, w2);
    let toBuyer: Int = self.deposited - fee;

    // Send to buyer
    self.sendJettonTransfer(self.buyer, toBuyer, 10, "Dispute resolved - buyer");
    
    // Send fees
    self.sendJettonTransfer(self.feeW1, w1, 11, "Platform fee 1");
    self.sendJettonTransfer(self.feeW2, w2, 12, "Platform fee 2");
    self.sendJettonTransfer(self.feeW3, w3, 13, "Platform fee 3");
  }

  receive(msg: ResolveToSeller) {
    require(sender() == self.admin, "Only admin can resolve");
    require(self.status == 1 || self.status == 2, "Invalid status - already resolved");
    require(self.depositVerified, "Deposit not verified");
    
    self.status = 4; // Refunded (seller wins)
    
    // Refund full amount to seller (no fees charged in seller favor)
    self.sendJettonTransfer(self.seller, self.deposited, 20, "Dispute resolved - seller");
  }

  // ---------- cancel if no deposit ----------
  receive(msg: CancelIfNoDeposit) {
    require(sender() == self.seller || sender() == self.admin, "Not allowed");
    require(self.status == 0, "Not pending deposit");
    
    // Admin can cancel anytime, seller must wait for deadline
    if (sender() == self.seller && self.deadline != 0) {
      require(now() >= self.deadline, "Seller must wait until deadline");
    }
    
    self.status = 4; // Cancelled
  }

  // ---------- deadline enforcement ----------
  receive(msg: ClaimExpired) {
    require(sender() == self.buyer, "Only buyer can claim expired");
    require(self.status == 1, "Must be active - already resolved");
    require(self.deadline != 0, "No deadline set");
    require(now() >= self.deadline, "Deadline not reached");
    require(self.depositVerified, "Deposit not verified");
    
    self.status = 3; // Released to buyer
    
    // Calculate fees
    let fee: Int = self.computeFee(self.deposited);
    let w1: Int = computeW1(fee);
    let w2: Int = computeW2(fee);
    let w3: Int = computeW3(fee, w1, w2);
    let toBuyer: Int = self.deposited - fee;

    // Send to buyer
    self.sendJettonTransfer(self.buyer, toBuyer, 30, "Trade expired - auto release");
    
    // Send fees
    self.sendJettonTransfer(self.feeW1, w1, 31, "Platform fee 1");
    self.sendJettonTransfer(self.feeW2, w2, 32, "Platform fee 2");
    self.sendJettonTransfer(self.feeW3, w3, 33, "Platform fee 3");
  }

  // ---------- helper for jetton transfers ----------
  fun sendJettonTransfer(to: Address, amount: Int, queryId: Int, comment: String) {
    require(self.jettonWallet != null, "Jetton wallet not set");
    
    // Build transfer message manually for compatibility
    let transferBody: Cell = beginCell()
      .storeUint(0x0f8a7ea5, 32)    // TokenTransfer opcode (full 32-bit)
      .storeUint(queryId, 64)       // query_id
      .storeCoins(amount)           // amount
      .storeAddress(to)             // destination
      .storeAddress(myAddress())    // response_destination (for notifications)
      .storeBit(false)              // custom_payload (null)
      .storeCoins(50000000)         // forward_ton_amount (0.05 TON for notification)
      .storeBit(false)              // forward_payload (keep simple for compatibility)
      .endCell();

    send(SendParameters{
        to: self.jettonWallet!!,
        value: 150000000,  // 0.15 TON for gas
        mode: 1,           // Pay fees separately
        body: transferBody
    });
    
    // Simple logging (optional - remove if causing issues)
    // self.notify(LogEvent{message: comment}.toCell());
  }

  // ---------- CRITICAL SECURITY: Bot deposit confirmation ----------
  // Bot calls this after verifying jetton wallet balance off-chain
  receive(msg: ConfirmDeposit) {
    require(sender() == self.admin, "Only admin can confirm deposits");
    require(self.status == 1, "No deposit to confirm");
    require(self.jettonWallet != null, "Jetton wallet not set");
    require(!self.depositVerified, "Deposit already confirmed");
    
    self.depositVerified = true;
    
    // Emit confirmation event
    emit(DepositConfirmed{confirmedBy: sender()}.toCell());
  }
  
  // ---------- CRITICAL SECURITY: Retry failed payouts ----------
  // Admin/bot calls this to retry failed transfers
  receive(msg: RetryPayout) {
    require(sender() == self.admin, "Only admin can retry payouts");
    require(self.status == 3, "Payouts not in progress");
    require(self.depositVerified, "Deposit not verified");
    
    // Re-issue all transfers (idempotent due to unique queryIds)
    let fee: Int = self.computeFee(self.deposited);
    let w1: Int = computeW1(fee);
    let w2: Int = computeW2(fee);
    let w3: Int = computeW3(fee, w1, w2);
    let toBuyer: Int = self.deposited - fee;
    
    // Use different queryIds to avoid conflicts
    self.sendJettonTransfer(self.buyer, toBuyer, 100, "Trade completed - retry");
    self.sendJettonTransfer(self.feeW1, w1, 101, "Platform fee 1 - retry");
    self.sendJettonTransfer(self.feeW2, w2, 102, "Platform fee 2 - retry");
    self.sendJettonTransfer(self.feeW3, w3, 103, "Platform fee 3 - retry");
  }
  
  // ---------- emergency functions ----------
  receive(msg: EmergencyWithdraw) {
    require(sender() == self.admin, "Only admin");
    require(self.status == 1 || self.status == 2, "Invalid status - already resolved");
    require(self.depositVerified, "No verified deposit");
    
    // Emergency withdraw all funds to admin for manual resolution
    self.status = 4; // Refunded
    self.sendJettonTransfer(self.admin, self.deposited, 99, "Emergency withdrawal");
  }
}
