// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

contract EscrowVault {
    address public owner;
    IERC20 public immutable token; // USDT (BEP-20)

    // Fee wallets and split
    address public feeWallet1;
    address public feeWallet2;
    address public feeWallet3;
    // feePercent in basis points (e.g., 100 = 1.00%)
    uint256 public feePercent;

    event Released(address indexed to, uint256 grossAmount, uint256 netAmount, uint256 feeAmount);
    event Refunded(address indexed to, uint256 grossAmount, uint256 netAmount, uint256 feeAmount);
    event FeeWalletsUpdated(address w1, address w2, address w3);
    event FeePercentUpdated(uint256 feePercent);

    modifier onlyOwner() {
        require(msg.sender == owner, 'not-owner');
        _;
    }

    constructor(address _token, address _w1, address _w2, address _w3, uint256 _feePercent) {
        owner = msg.sender;
        token = IERC20(_token);
        feeWallet1 = _w1;
        feeWallet2 = _w2;
        feeWallet3 = _w3;
        feePercent = _feePercent; // 100 = 1%
    }

    function setOwner(address _owner) external onlyOwner {
        owner = _owner;
    }

    function setFeeWallets(address _w1, address _w2, address _w3) external onlyOwner {
        feeWallet1 = _w1;
        feeWallet2 = _w2;
        feeWallet3 = _w3;
        emit FeeWalletsUpdated(_w1, _w2, _w3);
    }

    function setFeePercent(uint256 _feePercent) external onlyOwner {
        require(_feePercent <= 1000, 'too-high'); // <= 10%
        feePercent = _feePercent;
        emit FeePercentUpdated(_feePercent);
    }

    function _splitAndDistributeFee(uint256 fee) internal {
        if (fee == 0) return;
        uint256 f1 = (fee * 70) / 100; // 70%
        uint256 f2 = (fee * 225) / 1000; // 22.5%
        uint256 f3 = fee - f1 - f2;    // 7.5% remainder
        require(token.transfer(feeWallet1, f1), 'fee1-fail');
        require(token.transfer(feeWallet2, f2), 'fee2-fail');
        require(token.transfer(feeWallet3, f3), 'fee3-fail');
    }

    function release(address to, uint256 amount) external onlyOwner {
        uint256 fee = (amount * feePercent) / 10000; // basis points
        uint256 net = amount - fee;
        _splitAndDistributeFee(fee);
        require(token.transfer(to, net), 'transfer-fail');
        emit Released(to, amount, net, fee);
    }

    function refund(address to, uint256 amount) external onlyOwner {
        uint256 fee = (amount * feePercent) / 10000;
        uint256 net = amount - fee;
        _splitAndDistributeFee(fee);
        require(token.transfer(to, net), 'transfer-fail');
        emit Refunded(to, amount, net, fee);
    }

    // Owner utility: sweep any ERC-20 token balance to a specified address
    function withdrawToken(address erc20Token, address to) external onlyOwner {
        require(to != address(0), 'zero-to');
        IERC20 t = IERC20(erc20Token);
        uint256 bal = t.balanceOf(address(this));
        require(bal > 0, 'no-balance');
        require(t.transfer(to, bal), 'sweep-fail');
    }
}