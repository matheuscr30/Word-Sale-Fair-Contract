pragma solidity ^0.5.8;

import "./math/SafeMath.sol";

contract WordSale {
    using SafeMath for uint;

    event WordSaleCreated(address indexed buyer, address indexed seller);
    event Commit(address indexed participant, uint collateral);
    event BloomFilterSent(address indexed participant);
    event SaleStarted(address indexed buyer, uint value, uint penalty, uint factor);
    event Deposit(address indexed participant, uint value);
    event SaleAccepted(address indexed buyer);
    event SaleRefused(address indexed buyer);
    event Withdraw(address indexed participant, uint value);
    event LitigiousResult(bool sellerHonesty, uint bloomFilterRegistered, uint bloomFilterBuilt);
    event Refund(uint refund);

    enum SaleState {
        BUYER_COMMIT,
        SELLER_COMMIT,
        BUYER_SEND_BLOOM_FILTER,
        SELLER_SEND_BLOOM_FILTER,
        BUYER_START_SALE,
        SELLER_DEPOSIT,
        BUYER_CONFIRM_SALE,
        SALE_ACCEPTED,
        LITIGIOUS_MODE,
        SALE_LOCKED
    }

    mapping(address => uint) public withdraws;
    mapping(address => uint) public deposits;

    address public seller;
    address public buyer;

    uint numberOfHashes;

    uint bloomFilterSeller;
    uint bloomFilterBuyer;
    uint collateralBuyer;
    uint collateralSeller;

    uint penalty;
    uint factor;

    uint timeoutDuration;
    uint public endTimeState;

    SaleState public state;

    constructor(
        address _seller,
        uint _timeoutDuration,
        uint _numberOfHashes
    ) public {
        buyer = msg.sender;
        seller = _seller;
        timeoutDuration = _timeoutDuration;
        numberOfHashes = _numberOfHashes;

        withdraws[buyer] = 0;
        withdraws[seller] = 0;

        state = SaleState.BUYER_COMMIT;
        emit WordSaleCreated(buyer, seller);
    }

    modifier onlyParticipant() {
        require(buyer == msg.sender ||
        seller == msg.sender, "Should be participant of contract");
        _;
    }

    modifier onlyBuyer() {
        require(buyer == msg.sender, "Should be Buyer");
        _;
    }

    modifier onlySeller() {
        require(seller == msg.sender, "Should be Seller");
        _;
    }

    modifier onlyIfExpired() {
        require(now >= endTimeState, "Time is not expired yet");
        _;
    }

    modifier onlyIfNotExpired() {
        require(now < endTimeState, "Time expired for this stage");
        _;
    }

    function commitCollateral() public payable onlyParticipant {
        if (msg.sender == buyer) {
            require(state == SaleState.BUYER_COMMIT, "Buyer cannot commit collateral");
            state = SaleState.SELLER_COMMIT;
            collateralBuyer = msg.value;
            endTimeState = now + timeoutDuration;
            emit Commit(msg.sender, msg.value);
        } else if (msg.sender == seller) {
            require(state == SaleState.SELLER_COMMIT, "Seller cannot commit collateral");
            require(now < endTimeState, "Time expired for commit the collateral");
            state = SaleState.BUYER_SEND_BLOOM_FILTER;
            collateralSeller = msg.value;
            endTimeState = now + timeoutDuration;
            emit Commit(msg.sender, msg.value);
        }
    }

    function sendBloomFilter(uint bloomFilter) public onlyParticipant onlyIfNotExpired {
        if (msg.sender == buyer) {
            require(state == SaleState.BUYER_SEND_BLOOM_FILTER, "Buyer cannot send bloom filter");
            state = SaleState.SELLER_SEND_BLOOM_FILTER;
            bloomFilterBuyer = bloomFilter;
            withdraws[buyer] = collateralBuyer;
            endTimeState = now + timeoutDuration;
        } else if (msg.sender == seller) {
            require(state == SaleState.SELLER_SEND_BLOOM_FILTER, "Seller cannot send bloom filter");
            state = SaleState.BUYER_START_SALE;
            bloomFilterSeller = bloomFilter;
            withdraws[seller] = collateralSeller;
        }

        emit BloomFilterSent(msg.sender);
    }

    function startSale(uint _penalty, uint _factor) public payable onlyBuyer {
        require(state == SaleState.BUYER_START_SALE, "Buyer cannot start sale");

        state = SaleState.SELLER_DEPOSIT;
        deposits[msg.sender] = msg.value;
        penalty = _penalty;
        factor = _factor;
        endTimeState = now + timeoutDuration;

        emit SaleStarted(msg.sender, msg.value, penalty, factor);
    }

    function deposit() public payable onlySeller onlyIfNotExpired {
        require(state == SaleState.SELLER_DEPOSIT, "Seller cannot deposit");
        require(penalty == msg.value, "Tokens should be equal penalty amount");

        state = SaleState.BUYER_CONFIRM_SALE;
        deposits[msg.sender] = msg.value;

        emit Deposit(msg.sender, msg.value);
    }

    function acceptSale() external onlyBuyer {
        require(state == SaleState.BUYER_CONFIRM_SALE, "Buyer cannot accept the sale");

        state = SaleState.SALE_ACCEPTED;
        uint outcome = deposits[seller].add(deposits[buyer]);
        withdraws[seller] = withdraws[seller].add(outcome);

        emit SaleAccepted(msg.sender);
    }

    function refuseSale() external onlyBuyer {
        require(state == SaleState.BUYER_CONFIRM_SALE, "Buyer cannot refuse the sale");

        state = SaleState.LITIGIOUS_MODE;
        endTimeState = now + timeoutDuration;

        emit SaleRefused(msg.sender);
    }

    function sendWords(uint[] memory words) public onlySeller onlyIfNotExpired {
        require(state == SaleState.LITIGIOUS_MODE, "Sale should be refused");

        uint bloomFilter = 0;
        for (uint i = 0; i < words.length; i++) {
            for (uint j = 1; j <= numberOfHashes; j++) {
                uint256 bitPos = uint256(keccak256(abi.encodePacked(words[i], j))) % 256;
                uint256 mask = 1 << bitPos;
                bloomFilter |= mask;
            }
        }

        state = SaleState.SALE_LOCKED;

        if (bloomFilter == bloomFilterSeller) {
            uint factorAmount = deposits[seller].mul(factor).div(100);
            uint penaltyAmount = deposits[seller].sub(factorAmount);
            withdraws[seller] = deposits[buyer].add(penaltyAmount);
        } else {
            withdraws[buyer] = deposits[buyer].add(deposits[seller]);
        }

        emit LitigiousResult(bloomFilter == bloomFilterSeller, bloomFilterSeller, bloomFilter);
    }

    function calculateRefund() public onlyParticipant onlyIfExpired {
        emit Refund(2);
        if (state == SaleState.BUYER_START_SALE ||
        state == SaleState.BUYER_CONFIRM_SALE ||
        state >= SaleState.SALE_ACCEPTED)
            return;

        SaleState previousState = state;
        state = SaleState.SALE_LOCKED;
        if (previousState >= SaleState.BUYER_COMMIT && previousState <= SaleState.BUYER_SEND_BLOOM_FILTER) {
            withdraws[buyer] = collateralBuyer;
            withdraws[seller] = collateralSeller;
        } else if (previousState == SaleState.SELLER_SEND_BLOOM_FILTER) {
            withdraws[buyer] = collateralBuyer.add(collateralSeller);
        } else if (previousState == SaleState.SELLER_DEPOSIT) {
            withdraws[buyer] = deposits[buyer];
        } else if (previousState == SaleState.LITIGIOUS_MODE) {
            withdraws[buyer] = deposits[buyer].add(deposits[seller]);
        }

        emit Refund(withdraws[buyer]);
    }

    function withdraw() external onlyParticipant {
        if (now >= endTimeState) calculateRefund();
        emit Refund(123);

        if (withdraws[msg.sender] <= 0) {
            revert("No ether to transfer");
        }

        uint withdrawQuantity = withdraws[msg.sender];
        withdraws[msg.sender] = 0;
        msg.sender.transfer(withdrawQuantity);

        emit Withdraw(msg.sender, withdrawQuantity);
    }

    function() external payable {
        revert("Cannot use fallback function");
    }
}
