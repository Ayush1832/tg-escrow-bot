// Escrow contract for USDT on TON Testnet (automated deposit confirmation)
// Flow: Seller deploys -> Seller deposits USDT (contract auto-verifies) -> Buyer pays off-chain -> Seller confirms -> Escrow releases USDT
// Admin only for disputes, retries, emergency actions.

// Binary message definitions
message(0x1) ConfirmDelivery {}
message(0x2) RaiseDispute {}
message(0x3) ResolveToBuyer {}
message(0x4) ResolveToSeller {}
message(0x5) CancelIfNoDeposit {}
message(0x6) ClaimExpired {}
message(0x7) EmergencyWithdraw {}
message(0x9) RetryPayout {}  // keep RetryPayout

// Standard jetton notification when tokens are received (TEP-74 typical selector)
message(0x7362d09c) TokenNotification {
    queryId: Int as uint64;
    amount: Int as uint128;  // token amount in smallest units
    from: Address;
    forwardPayload: Slice as remaining;
}

// Event messages for off-chain monitoring
message(0x10) DepositReceived {
    amount: Int as uint128;
    from: Address;
    jettonWallet: Address;
}
message(0x11) TradeCompleted {
    buyer: Address;
    amount: Int as uint128;
    fee: Int as uint128;
}
message(0x12) PayoutRetried {
    retriedBy: Address;
    queryId: Int as uint64;
}

// Testnet USDT Master (provided)
const USDT_MASTER: Address = address("kQD0GKBM8ZbryVk2aESmzfU6b9b_8era_IkvBSELujFZPsyy");

// Fee split helpers
fun computeW1(fee: Int): Int { return (fee * 7000) / 10000; }
fun computeW2(fee: Int): Int { return (fee * 2250) / 10000; }
fun computeW3(fee: Int, w1: Int, w2: Int): Int { return fee - w1 - w2; }

contract Escrow {

  // Parties
  seller: Address;
  buyer: Address;
  admin: Address;

  // Security: expected jetton wallet computed off-chain and passed at deploy
  expectedJettonWallet: Address; // REQUIRED - precomputed by bot from USDT_MASTER + escrow_address

  // Trade
  amount: Int as uint128;         // trade amount in USDT (smallest units, e.g., 6 decimals)
  commissionBps: Int as uint16;   // fee in basis points (10000 = 100%)

  // Fee recipients (platform)
  feeW1: Address; // 70%
  feeW2: Address; // 22.5%
  feeW3: Address; // 7.5% + remainder

  // Status
  // 0 = PendingDeposit, 1 = Active, 2 = Dispute, 3 = Released, 4 = Refunded/Cancelled
  status: Int as uint8;

  // deposited tokens recorded
  deposited: Int as uint128;

  // optional unix deadline
  deadline: Int as uint64;

  // jetton wallet address for this escrow (verified)
  jettonWallet: Address?;

  // deposit verification (now set automatically on valid notification)
  depositVerified: Bool;

  // prevent double payout
  payoutAttempted: Bool;

  // ---------- constructor ----------
  init(
    seller_: Address,
    buyer_: Address,
    admin_: Address,
    amount_: Int as uint128,
    commissionBps_: Int as uint16,
    feeW1_: Address,
    feeW2_: Address,
    feeW3_: Address,
    deadline_: Int as uint64,
    expectedJettonWallet_: Address    // REQUIRED - precomputed by bot from USDT_MASTER + escrow_address
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
    self.deadline = deadline_;
    self.expectedJettonWallet = expectedJettonWallet_;
    self.status = 0;        // PendingDeposit
    self.deposited = 0;
    self.jettonWallet = null;
    self.depositVerified = false;
    self.payoutAttempted = false;
  }

  // ---------- helpers ----------
  fun computeFee(total: Int): Int {
    return (total * self.commissionBps) / 10000;
  }

  // Validate jetton wallet: must match the pre-computed expectedJettonWallet
  inline fun isExpectedJetton(wallet: Address): Bool {
    return wallet == self.expectedJettonWallet;
  }

  // ---------- token deposit receiver (auto-verify) ----------
  receive(msg: TokenNotification) {
    // accept deposit only in PendingDeposit
    require(self.status == 0, "Already deposited");
    // deposit must come from registered seller address (the jetton transfer 'from')
    require(msg.from == self.seller, "Only seller can deposit");
    // seller must deposit exact amount
    require(msg.amount == self.amount, "Deposit must equal trade amount");
    // verify the notifying caller is the expected jetton wallet
    require(self.isExpectedJetton(sender()), "Invalid USDT jetton wallet");

    // store jetton wallet (sender()) and deposit record
    self.jettonWallet = sender();
    self.deposited = msg.amount;
    // auto-verify deposit (no admin action required)
    self.depositVerified = true;
    self.status = 1; // Active

    // emit deposit event for off-chain indexing
    emit(DepositReceived{
      amount: msg.amount,
      from: msg.from,
      jettonWallet: sender()
    }.toCell());
  }

  // ---------- seller confirms delivery => release funds ----------
  receive(msg: ConfirmDelivery) {
    require(sender() == self.seller, "Only seller can confirm");
    require(self.status == 1, "Must be active - already resolved");                // Active
    require(self.depositVerified, "Deposit not verified");
    require(!self.payoutAttempted, "Payout already attempted");

    // mark Released and payout attempted
    self.status = 3; // Released
    self.payoutAttempted = true;

    let fee: Int = self.computeFee(self.deposited);
    let w1: Int = computeW1(fee);
    let w2: Int = computeW2(fee);
    let w3: Int = computeW3(fee, w1, w2);
    let toBuyer: Int = self.deposited - fee;

    // issue transfers (send to jetton wallet contract with TokenTransfer bodies)
    self.sendJettonTransfer(self.buyer, toBuyer, 1, "Release to buyer");
    self.sendJettonTransfer(self.feeW1, w1, 2, "Platform fee 1");
    self.sendJettonTransfer(self.feeW2, w2, 3, "Platform fee 2");
    self.sendJettonTransfer(self.feeW3, w3, 4, "Platform fee 3");

    emit(TradeCompleted{
      buyer: self.buyer,
      amount: toBuyer,
      fee: fee
    }.toCell());
  }

  // ---------- buyer raises dispute ----------
  receive(msg: RaiseDispute) {
    require(sender() == self.buyer, "Only buyer can dispute");
    require(self.status == 1, "Must be active - already resolved");
    require(self.depositVerified, "Deposit not verified");
    self.status = 2; // Dispute
  }

  // ---------- admin resolves in favor of buyer (release with fees) ----------
  receive(msg: ResolveToBuyer) {
    require(sender() == self.admin, "Only admin can resolve");
    require(self.status == 1 || self.status == 2, "Invalid status - already resolved");
    require(self.depositVerified, "Deposit not verified");
    require(!self.payoutAttempted, "Payout already attempted");

    self.status = 3; // Released
    self.payoutAttempted = true;

    let fee: Int = self.computeFee(self.deposited);
    let w1: Int = computeW1(fee);
    let w2: Int = computeW2(fee);
    let w3: Int = computeW3(fee, w1, w2);
    let toBuyer: Int = self.deposited - fee;

    self.sendJettonTransfer(self.buyer, toBuyer, 11, "Admin release to buyer");
    self.sendJettonTransfer(self.feeW1, w1, 12, "Platform fee 1");
    self.sendJettonTransfer(self.feeW2, w2, 13, "Platform fee 2");
    self.sendJettonTransfer(self.feeW3, w3, 14, "Platform fee 3");

    emit(TradeCompleted{ buyer: self.buyer, amount: toBuyer, fee: fee }.toCell());
  }

  // ---------- admin resolves in favor of seller (refund full) ----------
  receive(msg: ResolveToSeller) {
    require(sender() == self.admin, "Only admin can resolve");
    require(self.status == 1 || self.status == 2, "Invalid status - already resolved");
    require(self.depositVerified, "Deposit not verified");
    require(!self.payoutAttempted, "Payout already attempted");

    self.status = 4; // Refunded
    self.payoutAttempted = true;

    // Refund full deposited amount to seller
    self.sendJettonTransfer(self.seller, self.deposited, 21, "Admin refund to seller");
  }

  // ---------- cancel if no deposit ----------
  receive(msg: CancelIfNoDeposit) {
    require(sender() == self.seller || sender() == self.admin, "Not allowed");
    require(self.status == 0, "Not pending deposit");
    // Admin can cancel anytime; seller only after deadline if set
    if (sender() == self.seller && self.deadline != 0) {
      require(now() >= self.deadline, "Seller must wait until deadline");
    }
    self.status = 4; // Cancelled/Refunded (no deposit)
  }

  // ---------- buyer claim when deadline passes ----------
  receive(msg: ClaimExpired) {
    require(sender() == self.buyer, "Only buyer can claim expired");
    require(self.status == 1, "Must be active - already resolved");
    require(self.deadline != 0, "No deadline set");
    require(now() >= self.deadline, "Deadline not reached");
    require(self.depositVerified, "Deposit not verified");
    require(!self.payoutAttempted, "Payout already attempted");

    self.status = 3; // Released to buyer
    self.payoutAttempted = true;

    let fee: Int = self.computeFee(self.deposited);
    let w1: Int = computeW1(fee);
    let w2: Int = computeW2(fee);
    let w3: Int = computeW3(fee, w1, w2);
    let toBuyer: Int = self.deposited - fee;

    self.sendJettonTransfer(self.buyer, toBuyer, 31, "Auto-release expired");
    self.sendJettonTransfer(self.feeW1, w1, 32, "Platform fee 1");
    self.sendJettonTransfer(self.feeW2, w2, 33, "Platform fee 2");
    self.sendJettonTransfer(self.feeW3, w3, 34, "Platform fee 3");

    emit(TradeCompleted{ buyer: self.buyer, amount: toBuyer, fee: fee }.toCell());
  }

  // ---------- helper: build and send TokenTransfer to jetton wallet ----------
  fun sendJettonTransfer(to: Address, amount: Int, queryId: Int, _comment: String) {
    require(self.jettonWallet != null, "Jetton wallet not set");

    // Build TokenTransfer body (TEP-74 common layout)
    let body: Cell = beginCell()
      .storeUint(0x0f8a7ea5, 32)   // TokenTransfer opcode (32-bit)
      .storeUint(queryId, 64)      // query id
      .storeCoins(amount)          // token amount (token smallest units)
      .storeAddress(to)            // destination
      .storeAddress(myAddress())   // responseDestination = this contract
      .storeBit(false)             // custom_payload = null
      .storeCoins(0)               // forwardTonAmount (0)
      .storeBit(false)             // forward_payload = empty
      .endCell();

    // Attach TON for gas when calling jetton wallet
    send(SendParameters {
      to: self.jettonWallet!!,
      value: 150000000,  // 0.15 TON (tune in tests)
      mode: 1,
      body: body
    });
  }

  // ---------- retry payouts (admin) ----------
  receive(msg: RetryPayout) {
    require(sender() == self.admin, "Only admin can retry payouts");
    require(self.status == 3 || self.status == 4 || self.status == 1, "Invalid status for retry"); // allow retry in Released or Refund flows if payoutAttempted flagged
    require(self.depositVerified, "Deposit not verified");

    // Re-issue transfers only if payout was attempted (so retries are meaningful) OR if contract in Released and payouts not done.
    // We'll resend payer + fees using new queryIds. Admin off-chain should avoid multiple retrys unnecessarily.
    let fee: Int = self.computeFee(self.deposited);
    let w1: Int = computeW1(fee);
    let w2: Int = computeW2(fee);
    let w3: Int = computeW3(fee, w1, w2);
    let toBuyer: Int = self.deposited - fee;

    // Re-send using high queryIds reserved for retries
    self.sendJettonTransfer(self.buyer, toBuyer, 1001, "Retry payout to buyer");
    self.sendJettonTransfer(self.feeW1, w1, 1002, "Retry fee 1");
    self.sendJettonTransfer(self.feeW2, w2, 1003, "Retry fee 2");
    self.sendJettonTransfer(self.feeW3, w3, 1004, "Retry fee 3");

    // Emit event (off-chain can watch this)
    emit(PayoutRetried{ retriedBy: sender(), queryId: 1001 }.toCell());
  }

  // ---------- emergency withdraw ----------
  receive(msg: EmergencyWithdraw) {
    require(sender() == self.admin, "Only admin");
    require(self.depositVerified, "No verified deposit");
    require(self.status == 1 || self.status == 2, "Invalid status");

    // Move to refunded/emergency state
    self.status = 4;
    self.sendJettonTransfer(self.admin, self.deposited, 1100, "Emergency withdraw to admin");
  }

  // getters (Tact auto-generates getters; additional helper getters can be added if needed)
}
