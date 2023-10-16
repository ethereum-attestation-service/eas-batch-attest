import { SchemaEncoder } from "@ethereum-attestation-service/eas-sdk";
import fs from "fs";
import { CSVToArray } from "./utils";
import { ethers } from "ethers";
import { EAS__factory } from "@ethereum-attestation-service/eas-contracts/dist/typechain-types/factories/contracts/EAS__factory";
import { AttestationRequestDataStruct } from "@ethereum-attestation-service/eas-contracts/deployments/mainnet/types/contracts/EAS";
require("dotenv").config();

// Config
const MAX_BATCH = 2; // Max number of attestations per batch
const schemaUid =
  "0x8af15e65888f2e3b487e536a4922e277dcfe85b4b18187b0cf9afdb802ba6bb6"; // isHuman
const schemaString = "bool isHuman";
const easContractAddress = "0xC2679fBD37d54388Ce493F1DB75320D236e1815e"; // Sepolia

const provider = new ethers.InfuraProvider(
  "sepolia",
  process.env.INFURA_API_KEY,
);
//

const wallet = new ethers.Wallet(
  process.env.WALLET_PRIVATE_KEY as string,
  provider,
);

const eas = EAS__factory.connect(easContractAddress, wallet);

async function buildAttestationRequests() {
  const schemaEncoder = new SchemaEncoder(schemaString);
  const csvText = await fs.promises.readFile("./test.csv", "utf-8");
  const parsedCsv = CSVToArray(csvText.trim(), ",");

  const allLinesHaveCorrectSchemaElementLength = parsedCsv.every((elements) => {
    return elements.length === schemaEncoder.schema.length + 1;
  });

  if (!allLinesHaveCorrectSchemaElementLength) {
    console.log("CSV has incorrect number of elements");
    process.exit(1);
  }

  const allAttestationRequests: AttestationRequestDataStruct[] = parsedCsv.map(
    (elements) => {
      const data = schemaEncoder.encodeData(
        elements.slice(1).map((element, index) => {
          const type = schemaEncoder.schema[index].type;
          const name = schemaEncoder.schema[index].name;
          return { name, type, value: element };
        }),
      );

      return {
        recipient: elements[0],
        data,
        refUID: ethers.ZeroHash,
        revocable: true,
        expirationTime: 0n,
        value: 0n,
      };
    },
  );
  return allAttestationRequests;
}

async function makeAttestations() {
  const allAttestationRequests = await buildAttestationRequests();

  const batches = [];
  let nonce = await wallet.getNonce();

  for (let i = 0; i < allAttestationRequests.length; i += MAX_BATCH) {
    batches.push(allAttestationRequests.slice(i, i + MAX_BATCH));
  }

  const estimate = await eas.multiAttest.estimateGas([
    {
      schema: schemaUid,
      data: batches[0],
    },
  ]);

  for (const [index, batch] of batches.entries()) {
    console.log(
      `Making batch ${index + 1} of ${batches.length} line numbers ${
        index * MAX_BATCH + 1
      } to ${(index + 1) * MAX_BATCH}`,
    );

    const tx = await eas.multiAttest(
      [
        {
          schema: schemaUid,
          data: batch,
        },
      ],
      { gasLimit: (estimate * 115n) / 100n, nonce },
    );

    nonce++;

    // const receipt = await tx.wait();
    console.log(`Transaction hash: ${tx.hash}`);
  }
}

async function estimateAttestations() {
  const allAttestationRequests = await buildAttestationRequests();
  const firstBatch = allAttestationRequests.slice(0, MAX_BATCH);

  const estimate = await eas.multiAttest.estimateGas([
    {
      schema: schemaUid,
      data: firstBatch,
    },
  ]);

  console.log("First Batch Estimate: ", estimate.toString());
}

makeAttestations();
// estimateAttestations();
