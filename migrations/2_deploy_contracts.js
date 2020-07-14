const WordSale = artifacts.require('./WordSale.sol');

module.exports = async (deployer, network, accounts) => {
  const seller = accounts[1];
  const timeoutDuration = 60 * 24;

  await deployer.deploy(
    WordSale,
    seller,
    timeoutDuration
  );
  const deployedWordSale = await WordSale.deployed();

  console.log('Deployed WordSale: ', deployedWordSale.address);
};
