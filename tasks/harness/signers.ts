import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/src/signers";
import {TokenContracts, Tokens} from "./tokens";
import Table from "cli-table3";
import {BigNumber} from "ethers";

interface AccountType {
  name: string;
  address: string;
  balance: BigNumber;
}


export class Signers {
  private static _instance: Signers;
  public tokens! : TokenContracts;
  public namedSigners! : Record<string, SignerWithAddress>;

  public static get Instance() {
    return this._instance || (this._instance = new this());
  }

  public async init() {
    const {ethers} = require("hardhat");
    this.namedSigners = await ethers.getNamedSigners();
    this.tokens = await Tokens();
    return this;
  }

  from(address: string) {
    for (let name in this.namedSigners) {
      if (this.namedSigners[name].address == address) {
        return name;
      }
    }
    return address;
  }

  signerFrom(name: string) {
    const {ethers} = require("hardhat");

    if (ethers.utils.isAddress(name)) {
      return this.namedSigners[this.from(name)];
    }
    const signer = this.namedSigners[name];
    if (signer) {
      return signer;
    }
    throw new Error(`NOT EXIST SIGNER : ${name}`);
  }

  addressFrom(name : string) {
    const {ethers} = require("hardhat");

    if (ethers.utils.isAddress(name)) {
      return name;
    }
    const signer = this.namedSigners[name];
    if (signer) {
      return signer.address;
    }
    throw new Error(`NOT EXIST SIGNER : ${name}`);
  }

  async all() {
    let result: AccountType[] = [];
    for (let name in this.namedSigners) {
      const signer = this.namedSigners[name];
      result.push({name, address:signer.address, balance: await signer.getBalance()})
    }
    return result;
  }

  async balanceTable(user: string) {
    const {ethers} = require("hardhat");
    const userAddress = this.addressFrom(user);

    let tokenNames:string[] = [];
    let tokenBalances:string[] = [];
    for (let token of this.tokens.all()) {
      tokenNames.push(await token.symbol())
      tokenBalances.push((await token.balanceOf(userAddress)).toString())
    }

    const table = new Table({head:["klay", ...tokenNames]})
    table.push([(await ethers.provider.getBalance(userAddress)).toString(),...tokenBalances]);
    return table;
  }

  async balanceTableWith(user: string, include:string[]) {
    const {ethers} = require("hardhat");
    const userAddress = this.addressFrom(user);
    let tokenNames:string[] = [];
    let tokenBalances:string[] = [];

    for (let token of this.tokens.all()) {
      if (!include || (include.includes(token.address) || include.includes(await token.symbol()))) {
        tokenNames.push(await token.symbol())
        tokenBalances.push((await token.balanceOf(userAddress)).toString())
      }
    }

    const table = new Table({head:["klay", ...tokenNames]})
    table.push([(await ethers.provider.getBalance(userAddress)).toString(),...tokenBalances]);
    return table;
  }
}


let instance: Signers
let semaphore = false;
export const Users = async () => {
  if (!instance && !semaphore) {
    semaphore = true;
    instance = Signers.Instance
    await instance.init()
  }
  return instance;
}
