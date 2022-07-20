import {task, types} from "hardhat/config";
import path from "path";
import glob from "glob";
import * as fs from "fs";

interface ABI {
    address: string
}

task("addresses", "Print and save the address of contracts")
    .addPositionalParam("outputPath", "save", "", types.string)
    .setAction(async ({outputPath}, {ethers, network}) => {
        const deploymentDir = `${__dirname}/../deployments`;

        const chains:{[name:string]: number } = {};
        glob.sync(path.resolve(deploymentDir, "*/.chainId"))
            .map(f => {
                const chainName = path.parse(path.parse(f).dir).name
                chains[chainName] = parseInt(fs.readFileSync(f, 'utf-8'));
            })

        const result: {
            [chainId:number] : {
                [contract:string]: string
            }
        } = {};

         glob.sync(path.resolve(deploymentDir, "*/*.json"))
             .forEach(f => {
                 const chainName = path.parse(path.parse(f).dir).name;
                 const chainId = chains[chainName];
                 if (!chainId) {
                     return;
                 }
                 const name = path.parse(f).name;
                 const address = (JSON.parse(fs.readFileSync(f, "utf-8")) as ABI).address
                 if (chainId in result) {
                     result[chainId][name] = address;
                 } else {
                    result[chainId] = {};
                    result[chainId][name] = address;
                 }
             })

        if (outputPath != "") {
            fs.writeFileSync(outputPath, JSON.stringify(result,undefined, 2))
        }
        if (network.config.chainId){
          console.log(result[network.config.chainId!.toString()]);
        } else {
          console.log(result);
        }
    });
