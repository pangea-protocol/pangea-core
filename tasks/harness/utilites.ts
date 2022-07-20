import {BigNumber, ContractTransaction} from "ethers";

export async function advanceBlock() {
    const {ethers, getChainId} = require("hardhat");
    if (await getChainId() == '31337') {
        // Hardhat 환경에서는 트랜잭션이 발생해야 블럭이 생성된다
        // 그러기 때문에 트랜잭션 없이 view function만 호출하는 경우 마치
        // 시간이 정지된 것과 같은 현상이 보인다.
        // 강제로 빈 블럭을 mining함으로써 다음 타임스탬프로 이동하도록 한다.
        return ethers.provider.send("evm_mine", []);
    }
}

export function toKoKRFormat(date:Date) {
    return new Intl.DateTimeFormat("ko-KR",{
        year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12:false
    }).format(date);
}

export async function doExecute(transaction: Promise<ContractTransaction>) {
    const tx = await transaction;
    const receipt = await tx.wait();
    const GAS_PRICE = tx.gasPrice!;

    const result = {
        gasUsed: receipt.gasUsed.mul(GAS_PRICE),
        price: (receipt.gasUsed.mul(GAS_PRICE).mul(100000).div(BigNumber.from(10).pow(18)).toNumber()) / 100000.,
    }

    console.log(`TX GAS USED : ${result.price} KLAY (${result.gasUsed})`)
}
