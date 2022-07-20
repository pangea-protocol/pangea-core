import {
  KDAI,
  KETH,
  KORC,
  KSP,
  KUSDT,
  KWBTC,
  WEMIX,
  WETH10
} from "../../types";
import {BigNumber} from "ethers";


export async function convertPrice(tokenAddress:string, amount:BigNumber): Promise<BigNumber> {
  const tokens = await Tokens();
  const info = await tokens.info(tokenAddress);

  const denom = BigNumber.from(10).pow(info.decimals)
  return BigNumber.from(Math.ceil(tokens.price(tokenAddress)*10000)).mul(amount).div(10000).div(denom);
}


export class TokenContracts {
  private static _instance: TokenContracts;

  public wklay!: WETH10;
  public kdai!:KDAI;
  public keth!:KETH;
  public korc!:KORC;
  public ksp!:KSP;
  public kusdt!:KUSDT;
  public kwbtc!:KWBTC;
  public wemix!:WEMIX;

  price(address: string) {
    switch (address) {
      case this.wklay.address:
        return 1.09
      case this.kdai.address:
        return 1
      case this.keth.address:
        return 2709.05
      case this.korc.address:
        return 0.3333
      case this.ksp.address:
        return 5.44
      case this.kusdt.address:
        return 1
      case this.kwbtc.address:
        return 40629.99
      case this.wemix.address:
        return 4.24
      default:
        return 0
    }
  }

  public static get Instance() {
    return this._instance || (this._instance = new this());
  }

  public async init() {
    const {ethers} = require("hardhat");

    this.wklay = await ethers.getContract('WETH10') as WETH10;
    this.kdai = await ethers.getContract('KDAI') as KDAI;
    this.keth = await ethers.getContract('KETH') as KETH;
    this.korc = await ethers.getContract('KORC') as KORC;
    this.ksp = await ethers.getContract('KSP') as KSP;
    this.kusdt = await ethers.getContract('KUSDT') as KUSDT;
    this.kwbtc = await ethers.getContract('KWBTC') as KWBTC;
    this.wemix = await ethers.getContract('WEMIX') as WEMIX;

    return this;
  }

  async info(address: string) {
    const token = await this.from(address)
    return {
      name : await token.name(),
      symbol : await token.symbol(),
      decimals : await token.decimals(),
      price: this.price(address),
      address: token.address
    }
  }

  async from(address: string) {
    const {ethers} = require('hardhat')
    if (address == ethers.constants.AddressZero) {
      return this.wklay;
    }

    for (const token of this.all()) {
      if (token.address == address || (await token.symbol()).toLowerCase() == address.toLowerCase()) {
        return token;
      }
    }
    throw new Error("NOT FOUND");
  }

  all() { return [this.wklay, this.kdai, this.keth, this.korc, this.ksp, this.kusdt, this.kwbtc, this.wemix] }
}


let instance: TokenContracts
let semaphore = false;
export const Tokens = async () => {
  if (!instance && !semaphore) {
    semaphore = true;
    instance = TokenContracts.Instance
    await instance.init()
  }
  return instance;
}
