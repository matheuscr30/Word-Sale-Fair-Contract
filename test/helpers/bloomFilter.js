const BN = (arg) => new web3.utils.BN(arg);
const soliditySha3 = web3.utils.soliditySha3;

class BloomFilter {
  constructor(size, numberOfHashes) {
    this.size = size;
    this.numberOfHashes = numberOfHashes;
    this.bloomFilter = BN(0);
  }

  add(words) {
    for (let word of words) {
      let wordNum = convertStrToNumber(word);

      for (let i = 1; i <= this.numberOfHashes; i++) {
        let bytes = soliditySha3(wordNum, i);
        let res = web3.utils.toBN(bytes);
        let bitPos = res.mod(BN(this.size));

        let mask = BN(0);
        mask = mask.bincn(bitPos.toNumber());

        this.bloomFilter = this.bloomFilter.or(BN(mask));
      }
    }
  }

  verify(word) {
    let wordNum = convertStrToNumber(word);

    for (let i = 1; i <= this.numberOfHashes; i++) {
      let bytes = soliditySha3(wordNum, i);
      let res = web3.utils.toBN(bytes);
      let bitPos = res.mod(BN(this.size));

      let mask = BN(0);
      mask = mask.bincn(bitPos.toNumber());

      if (!this.bloomFilter.eq(this.bloomFilter.or(BN(mask))))
        return false;
    }
    return true;
  }
}

const convertStrToNumber = word => {
  return word.split().reduce((sum, reduce) => {
    return sum + word.charCodeAt(0)
  }, 0);
};

const hash = data => {
  let _hash = require('crypto').createHash('sha256')
    .update(data).digest('hex');
  return _hash;
};

module.exports = {
  BloomFilter,
  convertStrToNumber
};
