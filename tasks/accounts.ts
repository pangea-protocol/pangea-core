import {task} from "hardhat/config";
import {Users} from "./harness/signers";
import Table from "cli-table3";


task("accounts", "Prints the list of accounts")
    .setAction(async () => {
      const users = await Users();

      const table = new Table({head:["name", "address", "balance"]})
      for (let user of await users.all()) {
        table.push([user.name, user.address, user.balance.toString()]);
      }
      console.log(table.toString());
    });

