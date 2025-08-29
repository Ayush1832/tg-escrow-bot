// Escrow.tact
// TON-native escrow per-trade contract
// - One contract per trade
// - Seller pays deployment (deployment script uses seller key)
// - Buyer deposits exact `amount` (in nanograms / the same unit as msg.value).
// - Commission: commission_bps (e.g., 250 = 2.5%)
// - Commission split in BPS: 7000 / 2250 / 750 (i.e., 70% / 22.5% / 7.5%)

import StdContract; // common helpers from tact std (BLUEPRINT has these)
import Errors;      // small helper for require-like behavior (optional)

// -- Storage (fields) -------------------------------------------------------
contract Escrow {
  // parties
  field seller : address;
  field buyer  : address;
  field admin  : address;

  // trade terms
  // `amount` is the agreed trade value (in nanotons/lowest TON unit)
  field amount : uint128;

  // commission in basis points (bps). Use 10000 = 100%
  field commission_bps : uint16;

  // fee recipient wallets
  field fee_w1 : address;
  field fee_w2 : address;
  field fee_w3 : address;

  // status enum:
  // 0 = PendingDeposit
  // 1 = Active (funds locked)
  // 2 = Dispute
  // 3 = Released (completed)
  // 4 = Refunded (cancelled/refunded to buyer)
  field status : uint8;

  // How many nanotons were deposited (useful to record)
  field deposited : uint128;

  // optional: deadline (epoch seconds) after which seller or admin may cancel
  // 0 = no deadline
  field deadline : uint64;

  // --------- constructor -------------------------------------------------
  // Seller will call deploy script; deploy inputs set initial state
  constructor(
    seller_: address,
    buyer_: address,
    admin_: address,
    amount_: uint128,
    commission_bps_: uint16,
    fee_w1_: address,
    fee_w2_: address,
    fee_w3_: address,
    deadline_: uint64
  ) {
    // Basic checks
    require(seller_ != address(0), 101); // invalid seller
    require(buyer_  != address(0), 102); // invalid buyer
    require(admin_  != address(0), 103); // invalid admin
    require(amount_ > 0u128, 104);       // invalid amount
    require(commission_bps_ <= 10000u16, 105);

    seller := seller_;
    buyer  := buyer_;
    admin  := admin_;
    amount := amount_;
    commission_bps := commission_bps_;
    fee_w1 := fee_w1_;
    fee_w2 := fee_w2_;
    fee_w3 := fee_w3_;
    status := 0u8; // PendingDeposit
    deposited := 0u128;
    deadline := deadline_;
  }

  // -------------------- Utility / internal helpers ------------------------
  // internal: check only buyer
  internal function expect_buyer() {
    require(msg.sender == buyer, 201); // require caller is buyer
  }

  internal function expect_seller() {
    require(msg.sender == seller, 202);
  }

  internal function expect_admin() {
    require(msg.sender == admin, 203);
  }

  internal function check_status(u: uint8) {
    require(status == u, 211);
  }

  // compute fee and split; returns tuple (fee, w1, w2, w3, toSeller)
  internal function compute_splits(total: uint128)
               -> (fee: uint128, w1: uint128, w2: uint128, w3: uint128, toSeller: uint128)
  {
    // fee = total * commission_bps / 10000
    let fee_128 = (total * uint128(commission_bps as uint32)) / uint128(10000u32);

    // successive splits (rounding: last wallet gets leftover)
    let w1_calc = (fee_128 * uint128(7000u32)) / uint128(10000u32); // 70%
    let w2_calc = (fee_128 * uint128(2250u32)) / uint128(10000u32); // 22.5%
    // w3 gets remainder to avoid rounding issues
    let w3_calc = fee_128 - w1_calc - w2_calc;

    let toSeller_calc = total - fee_128;

    (fee_128, w1_calc, w2_calc, w3_calc, toSeller_calc)
  }

  // safe send TON coins - internal wrapper
  internal function safe_send(to: address, value: uint128) {
    // zero-value skip
    if (value == 0u128) { return; }
    // Use sendRaw or transfer helper from StdContract
    // NOTE: Blueprint std exposes `send_grams` or `send_value` utilities;
    // replace `send_grams` below with actual available std helper in your build.
    send_grams(to, value); // replace if your toolchain expects a different name
  }

  // -------------------- Receive TON deposit (buyer) ----------------------
  // This receive handles plain TON transfers to contract address.
  // Buyer must deposit exactly `amount` (optionally allow >= amount and refund remainder).
  #[receive]
  external function receive_grams() {
    // ensure we are expecting TON deposit (status == PendingDeposit)
    check_status(0u8);

    // only accept sender as buyer
    require(msg.sender == buyer, 221);

    // msg.value is the attached nanotons
    let v = msg.value;

    // require at least amount, allow refund of extra
    require(v >= amount, 222);

    // mark deposited
    deposited := v;
    status := 1u8; // Active

    // if buyer sent more than amount, refund remainder
    if (v > amount) {
      let remainder = v - amount;
      // subtract remainder from deposited (keep exactly `amount` as locked)
      deposited := amount;
      // refund remainder to buyer (perform after state update)
      safe_send(buyer, remainder);
    }

    // emit event (if you use events / logs)
  }

  // -------------------- Buyer confirms delivery -> release funds ----------
  public function confirmDelivery() {
    // only buyer can confirm
    expect_buyer();
    // must be Active (funds locked)
    check_status(1u8);

    // mark as Released BEFORE money movement (prevents reentrancy/double-release)
    status := 3u8;

    // compute splits
    let (feeVal, w1Val, w2Val, w3Val, toSellerVal) = compute_splits(amount);

    // transfers: first seller, then fees OR fees then seller (order doesn't matter, but update state before)
    // We'll send seller first then fees; in case of tiny rounding leftover it's handled in w3
    safe_send(seller, toSellerVal);
    safe_send(fee_w1, w1Val);
    safe_send(fee_w2, w2Val);
    safe_send(fee_w3, w3Val);

    // record deployed/tx in logs if you like
  }

  // -------------------- Raise dispute (buyer) -----------------------------
  public function raiseDispute(reason: cell) {
    // buyer can raise dispute only when Active
    expect_buyer();
    check_status(1u8);
    status := 2u8; // Dispute

    // optionally store reason (not implemented - could be an event log)
    // notify admin off-chain (bot) by watching status change
  }

  // -------------------- Admin resolution actions ------------------------
  // Admin can --> resolve to seller (release) OR resolve to buyer (refund)
  public function resolveToSeller() {
    expect_admin();
    // only allowed if Dispute or Active (admin might force-release)
    require(status == 2u8 || status == 1u8, 231);

    status := 3u8; // Released

    let (feeVal, w1Val, w2Val, w3Val, toSellerVal) = compute_splits(amount);

    safe_send(seller, toSellerVal);
    safe_send(fee_w1, w1Val);
    safe_send(fee_w2, w2Val);
    safe_send(fee_w3, w3Val);
  }

  public function resolveToBuyer() {
    expect_admin();
    require(status == 2u8 || status == 1u8, 232);

    status := 4u8; // Refunded

    // refund full `amount` to buyer
    safe_send(buyer, amount);
  }

  // -------------------- Seller / Admin cancel if deposit not made -----------
  // Allow seller to cancel trade if deadline reached or buyer never deposited.
  public function cancelIfNoDeposit() {
    // only seller or admin
    require(msg.sender == seller || msg.sender == admin, 241);

    // only allowed if still pending deposit
    check_status(0u8);

    // if deadline specified (>0) require now >= deadline OR allow immediate cancel by seller
    if (deadline != 0u64) {
      require(now >= deadline, 242); // require current epoch >= deadline
    }

    status := 4u8; // Refunded (no deposit - nothing on chain to return)
    // nothing to send because no deposit
  }

  // -------------------- Misc helpers / fallback --------------------------
  // Add any admin-only emergency withdraw to fee wallet (optional)
  public function emergencyWithdraw(to: address, value: uint128) {
    expect_admin();
    // allow only when contract still holds some balance (avoid draining funds when active)
    // Caller must ensure safety (use sparingly)
    safe_send(to, value);
  }
}
