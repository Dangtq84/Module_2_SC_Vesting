import { Blockfrost, Lucid, Crypto, Addresses, Data, fromText, Constr, toHex} from "https://deno.land/x/lucid/mod.ts";
import "jsr:@std/dotenv/load";

// Lấy các biến từ env
const MNEMONIC = Deno.env.get("MNEMONIC");
const BLOCKFROST_ID = Deno.env.get("BLOCKFROST_ID");
const BLOCKFROST_NETWORK = Deno.env.get("BLOCKFROST_NETWORK")

const lucid = new Lucid({
    provider: new Blockfrost(
      BLOCKFROST_NETWORK,
      BLOCKFROST_ID,
    ),
  });


// Lấy thông tin địa chỉ ví chủ sở hữu
lucid.selectWalletFromSeed(MNEMONIC)

const owner_address = await lucid.wallet.address(); // Bech32 address
console.log (`Đ/c ví chủ sở hữu: ${owner_address}`)   //Hiển thị địa chỉ ví chủ sở hữu
const { payment: paymentOwner  } = Addresses.inspect(owner_address);
console.log(`PaymentOwner.hash: ${paymentOwner.hash}`);

// Thông tin địa chỉ ví người thụ hưởng
const beneficiary_address = "addr_test1qrjgrt0eqjlrn3wkd6m6rpllkzjff0xldchhl8jzwx430tkf4wx2mtkjxk0cqxgsh0t9rrfapzzgs0l4mlvh4uwsqvys3upzzm";
const { payment: paymentBeneficiary } = Addresses.inspect(beneficiary_address);
console.log (`Đ/c ví người thụ hưởng: ${beneficiary_address}`) 
console.log(`PaymentBeneficiary.hash: ${paymentBeneficiary.hash}`);


const vesting_scripts = lucid.newScript({
  type: "PlutusV3",
  script: "59022401010029800aba2aba1aba0aab9faab9eaab9dab9a488888896600264653001300800198041804800cdc3a400530080024888966002600460106ea800e2646644b30013370e900018059baa0018cc004c03cc030dd5000c8c040c044c044c044c044c044c044c04400646020602260226022602260226022602260220032232330010010032259800800c528456600266e3cdd71809800801c528c4cc008008c05000500e2022918081808800a44444b300159800998011bac3003301137540126eb8c050c054c054c044dd5002c4c8c8c8cc8966002601e602a6ea800a2b3001300f30153754603260340071337106eb4c064c058dd5001000c4cdc49bad30193016375400400280a22941014180b8009bad3017301437540106602a602c0026602b3001300c30123754602c602e0034c0103d87a8000a60103d8798000404497ae030123754600460246ea8004c010c044dd5004c528201e8a518acc004cc008dd6180198089baa009375c600260226ea801626464646644b3001300f301537540051598009807980a9baa3019301a003899b88001375a6032602c6ea800a266e24004dd6980c980b1baa002405114a080a0c05c004dd6980b980a1baa008330153016001330159800980618091baa30163017001a6103d87a8000a60103d8798000404497ae030123754602a60246ea8004c010c044dd5004c528201e403c8b2014300d001300d300e0013009375400716401c300800130033754011149a26cac8009",
  });

const vestingAddress = vesting_scripts.toAddress();
console.log(`Vesting address: ${vestingAddress}`);

// Định nghĩa cấu trúc VestingDatum
const VestingDatum = Data.Object({
  lock_until: Data.Integer(),
  owner: Data.Bytes(),
  beneficiary: Data.Bytes(),//VerificationKeyHash
});
type VestingDatum = typeof VestingDatum;

// Set the vesting deadline
const deadlineDate: Date = Date.now(); 
const offset = 10 * 60 * 1000; // 10 phút
const deadlinePosIx =BigInt((deadlineDate+offset))
console.log("deadlinePosIx: ", deadlinePosIx);

// Tạo Datum với giá trị cụ thể
const d = {
    lock_until: deadlinePosIx,
    owner: paymentOwner?.hash,
    beneficiary: paymentBeneficiary?.hash,
};
const datum = await Data.to<VestingDatum>(d, VestingDatum);

// Định nghĩa cấu trúc Redeemer
const RedeemerSchema = Data.Object({
  value: Data.Bytes,
});
type RedeemerSchema = typeof RedeemerSchema;

// Tạo một Redeemer với giá trị cụ thể
const Redeemer = () => Data.to({ value: fromText("C2VN_BK02_15, Module_2_SC_Vesting") }, RedeemerSchema);

// Hàm khóa UTxO
export async function lockUtxo(lovelace: bigint,): Promise<string> {
  console.log("=====Lock UTxO===========================================================")
  console.log("")
  console.log("Datum lock_until: ", Number(d.lock_until));
  const tx = await lucid
  .newTx()
  .payToContract(vestingAddress, { Inline: datum }, { lovelace })
  .validTo(Date.now() + 60000)// Thời gian hết hạn giao dịch (1 phút sau)
  .commit();
    
const signedTx = await tx.sign().commit();
console.log(signedTx);
    
const txHash = await signedTx.submit();
    
console.log(`Bạn có thể kiểm tra giao dịch tại: https://preview.cexplorer.io/tx/${txHash}`);
}

// Hàm mở khóa UTxO
export async function unlockUtxo(redeemer: RedeemerSchema, find_vest: Data.Bytes): Promise<string> {
  // Tìm UTxO tại địa chỉ vestingAddress
  console.log("====Unlock UTxO============================================================")
  console.log("")
  const utxo = (await lucid.utxosAt(vestingAddress)).find((utxo) => {
    if (!utxo.scriptRef && utxo.datum) {
      // Giải mã utxo.datum thành đối tượng Vestingdatum
      const decodedDatum = Data.from<VestingDatum>(utxo.datum, VestingDatum);
      // So sánh trường owner với expectedOwner
      return decodedDatum.owner === find_vest || decodedDatum.beneficiary === find_vest;
    }
    return false;
  });

  if (!utxo) {
    throw new Error("Không tìm thấy UTxO phù hợp!");   
  }

  console.log(`Unlock UTxO.txhash: ${utxo.txHash}`); // Hiển thị Datum của UTxO

  const decodedDatum1 = Data.from<VestingDatum>(utxo.datum, VestingDatum);
  console.log("Datum lock_until: ", Number(decodedDatum1.lock_until));
  console.log("Time offset:      ", - Number(decodedDatum1.lock_until) + Date.now());
  console.log(`Datum owner: ${decodedDatum1.owner}`);
  console.log(`Datum beneficiary: ${decodedDatum1.beneficiary}`);

  console.log(`Redeemer: ${redeemer}`); 
 
  const offsetvalid= 1 * 60 * 1000; // 1 phút

  // Tiếp tục thực hiện giao dịch
  const tx = await lucid
  .newTx()
  .collectFrom([utxo], Redeemer())
  .attachScript(vesting_scripts)
  .addSigner(paymentOwner?.hash)
  //.validTo(Date.now() + offsetvalid)//Người sở hữu mở khóa trước
  .validFrom(Date.now() - offsetvalid)//Người sở hữu mở khóa sau
  .commit();
      
  const signedTx = await tx.sign().commit();
      
  const txHash = await signedTx.submit();
      
  //return txHash;
  console.log(`Bạn có thể kiểm tra giao dịch tại: https://preview.cexplorer.io/tx/${txHash}`);
}

const lovelace_lock=100_000_000n

// Tạo hàm để chạy chương trình
async function main() {
try {
// Gọi hàm lockUtxo để khóa UTxO
//const txHash = await lockUtxo(lovelace_lock);
        
       
// Gọi hàm unlockUtxo để mở khóa UTxO
const redeemTxHash = await unlockUtxo(Redeemer(), d.owner);     
}

catch (error) {
console.error("Error locking UTxO:", error);
}
}
        
main();
