const { expectEvent, balance } = require('openzeppelin-test-helpers');
const { increaseTime, increaseTimeTo, duration } = require('./helpers/increaseTime');
const { advanceBlock } = require('./helpers/advanceToBlock');
const { latestTime } = require('./helpers/latestTime');
const { EVMRevert } = require('./helpers/EVMRevert');
const { BloomFilter, convertStrToNumber } = require('./helpers/bloomFilter');

require('chai')
  .use(require('chai-as-promised'))
  .use(require('bn-chai')(web3.utils.BN))
  .should();
const BN = (arg) => new web3.utils.BN(arg);

const WordSale = artifacts.require('WordSale');

async function computeCost(receipt) {
  let { gasPrice } = await web3.eth.getTransaction(receipt.transactionHash);
  return BN(gasPrice * receipt.gasUsed);
}

contract('WordSale', ([buyer, seller, userNotAuthorized]) => {

  const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';
  const SALE_STATE = {
    BUYER_COMMIT: 0,
    SELLER_COMMIT: 1,
    BUYER_SEND_BLOOM_FILTER: 2,
    SELLER_SEND_BLOOM_FILTER: 3,
    BUYER_START_SALE: 4,
    SELLER_DEPOSIT: 5,
    BUYER_CONFIRM_SALE: 6,
    SALE_ACCEPTED: 7,
    LITIGIOUS_MODE: 8,
    SALE_LOCKED: 9
  };

  const NUMBER_OF_HASHES = 3;
  const WORDS_BUYER = ['hey', 'hello', 'no way', 'programming'];
  const WORDS_SELLER = ['i', 'dont', 'know'];

  let bfBuyer = new BloomFilter(256, 3);
  bfBuyer.add(WORDS_BUYER);

  let bfSeller = new BloomFilter(256, 3);
  bfSeller.add(WORDS_SELLER);

  const BLOOM_FILTER_BUYER = bfBuyer.bloomFilter;
  const BLOOM_FILTER_SELLER = bfSeller.bloomFilter;
  const COLLATERAL = 1000;
  const PENALTY = 2000;
  const FACTOR = 30;
  const TIMEOUT_DURATION = 60 * 24;

  before(async function () {
    await advanceBlock();
  });

  beforeEach(async function () {
    this.contract = await WordSale.new(
      seller,
      TIMEOUT_DURATION,
      NUMBER_OF_HASHES
    );
  });

  it('should deploy with less than 7 mil gas', async function () {
    let result = await web3.eth.getTransactionReceipt(this.contract.transactionHash);
    let gasCost = result.gasUsed;
    gasCost.should.be.lessThan(7000000);
  });

  it('should create token sale contract with correct parameters', async function () {
    this.contract.should.exist;

    const _buyer = await this.contract.buyer();
    const _seller = await this.contract.seller();
    const _state = await this.contract.state();

    SALE_STATE.BUYER_COMMIT.should.eq.BN(_state);
    _buyer.should.be.equal(buyer);
    _seller.should.be.equal(seller);
  });

  it('should not let work fallback function', async function () {
    await this.contract.sendTransaction(
      { from: seller, value: 1 }
    ).should.be.rejectedWith(EVMRevert);
  });

  it('should let buyer commit in phase BUYER_COMMIT', async function () {
    let { logs } = await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    expectEvent.inLogs(logs, 'Commit', {
      participant: buyer,
      collateral: BN(COLLATERAL)
    });

    SALE_STATE.SELLER_COMMIT.should.eq.BN(await this.contract.state());
  });

  it('should not let seller or other user commit in phase BUYER_COMMIT', async function () {
    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    }).should.be.rejectedWith(EVMRevert);

    await this.contract.commitCollateral({
      from: userNotAuthorized,
      value: COLLATERAL
    }).should.be.rejectedWith(EVMRevert);

    SALE_STATE.BUYER_COMMIT.should.eq.BN(await this.contract.state());
  });

  it('should let seller deposit in phase SELLER_COMMIT', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    let { logs } = await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    });

    expectEvent.inLogs(logs, 'Commit', {
      participant: seller,
      collateral: BN(COLLATERAL)
    });

    SALE_STATE.BUYER_SEND_BLOOM_FILTER.should.eq.BN(await this.contract.state());
  });

  it('should not let seller deposit in phase SELLER_COMMIT after timeout', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await increaseTime(TIMEOUT_DURATION+1);

    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    }).should.be.rejectedWith(EVMRevert);

    SALE_STATE.SELLER_COMMIT.should.eq.BN(await this.contract.state());
  });

  it('should not let buyer or other user commit in phase SELLER_COMMIT', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    }).should.be.rejectedWith(EVMRevert);

    await this.contract.commitCollateral({
      from: userNotAuthorized,
      value: COLLATERAL
    }).should.be.rejectedWith(EVMRevert);

    SALE_STATE.SELLER_COMMIT.should.eq.BN(await this.contract.state());
  });

  it('should let buyer send bloom filter in phase BUYER_SEND_BLOOM_FILTER', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    });

    let { logs } = await this.contract.sendBloomFilter(BLOOM_FILTER_BUYER, {
      from: buyer
    });

    expectEvent.inLogs(logs, 'BloomFilterSent', {
      participant: buyer,
    });

    SALE_STATE.SELLER_SEND_BLOOM_FILTER.should.eq.BN(await this.contract.state());
  });

  it('should not let buyer send bloom filter in phase BUYER_SEND_BLOOM_FILTER after timeout', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    });

    await increaseTime(TIMEOUT_DURATION+1);

    await this.contract.sendBloomFilter(BLOOM_FILTER_BUYER, {
      from: buyer
    }).should.be.rejectedWith(EVMRevert);

    SALE_STATE.BUYER_SEND_BLOOM_FILTER.should.eq.BN(await this.contract.state());
  });

  it('should not let seller or other user send bloom filter in phase BUYER_SEND_BLOOM_FILTER', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_SELLER, {
      from: seller
    }).should.be.rejectedWith(EVMRevert);

    await this.contract.sendBloomFilter(BLOOM_FILTER_SELLER, {
      from: userNotAuthorized
    }).should.be.rejectedWith(EVMRevert);

    SALE_STATE.BUYER_SEND_BLOOM_FILTER.should.eq.BN(await this.contract.state());
  });

  it('should let seller send bloom filter in phase SELLER_SEND_BLOOM_FILTER', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_BUYER, {
      from: buyer
    });

    let { logs } = await this.contract.sendBloomFilter(BLOOM_FILTER_SELLER, {
      from: seller
    });

    expectEvent.inLogs(logs, 'BloomFilterSent', {
      participant: seller,
    });

    SALE_STATE.BUYER_START_SALE.should.eq.BN(await this.contract.state());
  });

  it('should not let seller send bloom filter in phase SELLER_SEND_BLOOM_FILTER after timeout', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_BUYER, {
      from: buyer
    });

    await increaseTime(TIMEOUT_DURATION+1);

    await this.contract.sendBloomFilter(BLOOM_FILTER_SELLER, {
      from: seller
    }).should.be.rejectedWith(EVMRevert);

    SALE_STATE.SELLER_SEND_BLOOM_FILTER.should.eq.BN(await this.contract.state());
  });

  it('should not let buyer or other user send bloom filter in phase SELLER_SEND_BLOOM_FILTER', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_BUYER, {
      from: buyer
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_BUYER, {
      from: buyer
    }).should.be.rejectedWith(EVMRevert);

    await this.contract.sendBloomFilter(BLOOM_FILTER_BUYER, {
      from: userNotAuthorized
    }).should.be.rejectedWith(EVMRevert);

    SALE_STATE.SELLER_SEND_BLOOM_FILTER.should.eq.BN(await this.contract.state());
  });

  it('should let seller or buyer withdraw the collateral in phase BUYER_START_SALE', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_BUYER, {
      from: buyer
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_SELLER, {
      from: seller
    });

    let expectedBalanceBuyer = (await balance.current(buyer)).add(BN(COLLATERAL));
    let expectedBalanceSeller = (await balance.current(seller)).add(BN(COLLATERAL));

    let buyerReceipt = await this.contract.withdraw({
      from: buyer
    });

    let sellerReceipt = await this.contract.withdraw({
      from: seller
    });

    (await balance.current(buyer)).should.eq.BN(expectedBalanceBuyer.sub(await computeCost(buyerReceipt.receipt)));
    (await balance.current(seller)).should.eq.BN(expectedBalanceSeller.sub(await computeCost(sellerReceipt.receipt)));

    expectEvent.inLogs(buyerReceipt.logs, 'Withdraw', {
      participant: buyer,
      value: BN(COLLATERAL)
    });

    expectEvent.inLogs(sellerReceipt.logs, 'Withdraw', {
      participant: seller,
      value: BN(COLLATERAL)
    });
  });

  it('should let buyer start the sale in phase BUYER_START_SALE', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_BUYER, {
      from: buyer
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_SELLER, {
      from: seller
    });

    let { logs } = await this.contract.startSale(PENALTY, FACTOR, {
      from: buyer,
      value: COLLATERAL
    });

    expectEvent.inLogs(logs, 'SaleStarted', {
      buyer: buyer,
      value: BN(COLLATERAL),
      penalty: BN(PENALTY),
      factor: BN(FACTOR)
    });

    SALE_STATE.SELLER_DEPOSIT.should.eq.BN(await this.contract.state());
  });

  it('should not let seller or other user start the sale in phase BUYER_START_SALE', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_BUYER, {
      from: buyer
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_SELLER, {
      from: seller
    });

    await this.contract.startSale(PENALTY, FACTOR, {
      from: seller,
      value: COLLATERAL
    }).should.be.rejectedWith(EVMRevert);

    SALE_STATE.BUYER_START_SALE.should.eq.BN(await this.contract.state());
  });

  it('should let seller deposit the penalty price in phase SELLER_DEPOSIT', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_BUYER, {
      from: buyer
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_SELLER, {
      from: seller
    });

    await this.contract.startSale(PENALTY, FACTOR, {
      from: buyer,
      value: COLLATERAL
    });

    let { logs } = await this.contract.deposit({
      from: seller,
      value: PENALTY
    });

    expectEvent.inLogs(logs, 'Deposit', {
      participant: seller,
      value: BN(PENALTY)
    });

    SALE_STATE.BUYER_CONFIRM_SALE.should.eq.BN(await this.contract.state());
  });

  it('should not let seller deposit the penalty price in phase SELLER_DEPOSIT after timeout', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_BUYER, {
      from: buyer
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_SELLER, {
      from: seller
    });

    await this.contract.startSale(PENALTY, FACTOR, {
      from: buyer,
      value: COLLATERAL
    });

    increaseTime(TIMEOUT_DURATION+1);

    await this.contract.deposit({
      from: seller,
      value: PENALTY
    }).should.be.rejectedWith(EVMRevert);

    SALE_STATE.SELLER_DEPOSIT.should.eq.BN(await this.contract.state());
  });

  it('should not let seller deposit a different value of the penalty pre-established in phase SELLER_DEPOSIT', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_BUYER, {
      from: buyer
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_SELLER, {
      from: seller
    });

    await this.contract.startSale(PENALTY, FACTOR, {
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.deposit({
      from: seller,
      value: 200
    }).should.be.rejectedWith(EVMRevert);

    SALE_STATE.SELLER_DEPOSIT.should.eq.BN(await this.contract.state());
  });

  it('should not let buyer or other user deposit in phase SELLER_DEPOSIT', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_BUYER, {
      from: buyer
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_SELLER, {
      from: seller
    });

    await this.contract.startSale(PENALTY, FACTOR, {
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.deposit({
      from: buyer,
      value: PENALTY
    }).should.be.rejectedWith(EVMRevert);

    await this.contract.deposit({
      from: userNotAuthorized,
      value: PENALTY
    }).should.be.rejectedWith(EVMRevert);

    SALE_STATE.SELLER_DEPOSIT.should.eq.BN(await this.contract.state());
  });

  it('should let buyer accept the sale in phase BUYER_CONFIRM_SALE', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_BUYER, {
      from: buyer
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_SELLER, {
      from: seller
    });

    await this.contract.startSale(PENALTY, FACTOR, {
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.deposit({
      from: seller,
      value: PENALTY
    });

    let { logs } = await this.contract.acceptSale({
      from: buyer
    });

    // collateral from initial phase + collateral from buyer + penalty
    let awaitedWithdrawAmount = COLLATERAL + COLLATERAL + PENALTY;
    let actualWithdrawAmount = await this.contract.withdraws(seller);
    actualWithdrawAmount.should.eq.BN(awaitedWithdrawAmount);

    expectEvent.inLogs(logs, 'SaleAccepted', {
      buyer: buyer
    });

    SALE_STATE.SALE_ACCEPTED.should.eq.BN(await this.contract.state());
  });

  it('should not let seller or other user accept the sale in phase BUYER_CONFIRM_SALE', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_BUYER, {
      from: buyer
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_SELLER, {
      from: seller
    });

    await this.contract.startSale(PENALTY, FACTOR, {
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.deposit({
      from: seller,
      value: PENALTY
    });

    await this.contract.acceptSale({
      from: seller
    }).should.be.rejectedWith(EVMRevert);

    await this.contract.acceptSale({
      from: userNotAuthorized
    }).should.be.rejectedWith(EVMRevert);

    SALE_STATE.BUYER_CONFIRM_SALE.should.eq.BN(await this.contract.state());
  });

  it('should let seller withdraw the correct amount in phase SALE_ACCEPTED', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_BUYER, {
      from: buyer
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_SELLER, {
      from: seller
    });

    await this.contract.startSale(PENALTY, FACTOR, {
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.deposit({
      from: seller,
      value: PENALTY
    });

    await this.contract.acceptSale({
      from: buyer
    });

    let awaitedWithdrawAmount = COLLATERAL + COLLATERAL + PENALTY;
    let expectedBalance = (await balance.current(seller)).add(BN(awaitedWithdrawAmount));

    let { receipt, logs } = await this.contract.withdraw({
      from: seller
    });
    (await balance.current(seller)).should.eq.BN(expectedBalance.sub(await computeCost(receipt)));

    expectEvent.inLogs(logs, 'Withdraw', {
      participant: seller,
      value: BN(awaitedWithdrawAmount)
    });
  });

  it('should let buyer refuse the sale in phase BUYER_CONFIRM_SALE', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_BUYER, {
      from: buyer
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_SELLER, {
      from: seller
    });

    await this.contract.startSale(PENALTY, FACTOR, {
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.deposit({
      from: seller,
      value: PENALTY
    });

    let { logs } = await this.contract.refuseSale({
      from: buyer
    });

    expectEvent.inLogs(logs, 'SaleRefused', {
      buyer: buyer
    });

    SALE_STATE.LITIGIOUS_MODE.should.eq.BN(await this.contract.state());
  });

  it('should not let seller or other user refuse the sale in phase BUYER_CONFIRM_SALE', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_BUYER, {
      from: buyer
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_SELLER, {
      from: seller
    });

    await this.contract.startSale(PENALTY, FACTOR, {
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.deposit({
      from: seller,
      value: PENALTY
    });

    await this.contract.refuseSale({
      from: seller
    }).should.be.rejectedWith(EVMRevert);

    await this.contract.refuseSale({
      from: userNotAuthorized
    }).should.be.rejectedWith(EVMRevert);

    SALE_STATE.BUYER_CONFIRM_SALE.should.eq.BN(await this.contract.state());
  });

  it('should let seller withdraw his amount when he send the correct words in phase LITIGIOUS_MODE', async function ()
  {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_BUYER, {
      from: buyer
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_SELLER, {
      from: seller
    });

    await this.contract.withdraw({
      from: buyer
    });

    await this.contract.withdraw({
      from: seller
    });

    await this.contract.startSale(PENALTY, FACTOR, {
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.deposit({
      from: seller,
      value: PENALTY
    });

    await this.contract.refuseSale({
      from: buyer
    });

    let words = WORDS_SELLER.map(w => convertStrToNumber(w));
    let { logs } = await this.contract.sendWords(words, {
      from: seller
    });

    expectEvent.inLogs(logs, 'LitigiousResult', {
      sellerHonesty: true,
      bloomFilterRegistered: BLOOM_FILTER_SELLER,
      bloomFilterBuilt: BLOOM_FILTER_SELLER
    });

    SALE_STATE.SALE_LOCKED.should.eq.BN(await this.contract.state());

    let factorAmount = (PENALTY * FACTOR) / 100;
    let penaltyAmount = PENALTY - factorAmount;
    let awaitedWithdrawAmount = COLLATERAL + penaltyAmount;

    let expectedBalance = (await balance.current(seller)).add(BN(awaitedWithdrawAmount));

    let { receipt, logs: logsWithdraw } = await this.contract.withdraw({
      from: seller
    });
    (await balance.current(seller)).should.eq.BN(expectedBalance.sub(await computeCost(receipt)));

    expectEvent.inLogs(logsWithdraw, 'Withdraw', {
      participant: seller,
      value: BN(awaitedWithdrawAmount)
    });
  });

  it('should not seller withdraw his amount when he send the wrong words in phase LITIGIOUS_MODE', async function () {
    await this.contract.commitCollateral({
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.commitCollateral({
      from: seller,
      value: COLLATERAL
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_BUYER, {
      from: buyer
    });

    await this.contract.sendBloomFilter(BLOOM_FILTER_SELLER, {
      from: seller
    });

    await this.contract.withdraw({
      from: buyer
    });

    await this.contract.withdraw({
      from: seller
    });

    await this.contract.startSale(PENALTY, FACTOR, {
      from: buyer,
      value: COLLATERAL
    });

    await this.contract.deposit({
      from: seller,
      value: PENALTY
    });

    await this.contract.refuseSale({
      from: buyer
    });

    let wrongWords = [...WORDS_SELLER, 'wrong', 'words'];
    let words = wrongWords.map(w => convertStrToNumber(w));
    let { logs } = await this.contract.sendWords(words, {
      from: seller
    });

    let bfWrong = new BloomFilter(256, 3);
    bfWrong.add(wrongWords);

    expectEvent.inLogs(logs, 'LitigiousResult', {
      sellerHonesty: false,
      bloomFilterRegistered: BLOOM_FILTER_SELLER,
      bloomFilterBuilt: bfWrong.bloomFilter
    });

    SALE_STATE.SALE_LOCKED.should.eq.BN(await this.contract.state());

    await this.contract.withdraw({
      from: seller
    }).should.be.rejectedWith(EVMRevert);

    let awaitedWithdrawAmount = COLLATERAL + PENALTY;
    let expectedBalance = (await balance.current(buyer)).add(BN(awaitedWithdrawAmount));

    let { receipt, logs: logsWithdraw } = await this.contract.withdraw({
      from: buyer
    });

    (await balance.current(buyer)).should.eq.BN(expectedBalance.sub(await computeCost(receipt)));

    expectEvent.inLogs(logsWithdraw, 'Withdraw', {
      participant: buyer,
      value: BN(awaitedWithdrawAmount)
    });
  });
});
