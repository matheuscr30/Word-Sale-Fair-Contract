const BigNumber = require('bignumber.js');
const SIZE = 256;

function calculateBloomFilter (number_of_hashes, words) {
  let bloomFilter = 0;

  for (let word of words) {
    console.log(word);
    for (let i = 1; i <= number_of_hashes; i++) {
      let data = i.toString() + word;
      let res = BigNumber(hash(data));
      console.log(res.toString());

      console.log(SIZE);
      let t = res.modulo(100000)
      console.log(t.toString())
      console.log(t);
      let mask = 1 << t;
      console.log(`Hash ${i} / Mask ${mask}`);
      bloomFilter |= mask;
      console.log(`Bloom Filter ${bloomFilter}`);
    }
  }
  return bloomFilter;
}

function hash(data) {
  let hash_ = require('crypto').createHash('sha256')
    .update(data).digest('hex');
  console.log("hash")
  console.log(hash_);
  console.log(hash_ % 256)
  console.log("terminou")
  return parseInt(hash_, 16);
}

module.exports = {
  calculateBloomFilter
};
