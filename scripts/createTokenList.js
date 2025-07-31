const fs = require('fs');
const path = require('path');
const Ajv = require('ajv').default;
const addFormats = require('ajv-formats');

const assetSchema = {
  "type": "object",
  "properties": {
    "name": { "type": "string", "maxLength": 30, "minLength": 4 },
    "contract": { "type": "string", "pattern": "^C[A-Z0-9]{55}$" },
    "code": { "type": "string", "pattern": "^[A-Za-z0-9]{1,12}$" },
    "issuer": { "type": "string", "pattern": "^G[A-Z0-9]{55}$" },
    "org": { "type": "string", "maxLength": 30, "minLength": 5 },
    "domain": { "type": "string", "pattern": "^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$" },
    "icon": { 
      "type": "string",
      "oneOf": [
        { "format": "uri" },
        { "pattern": "^baf[a-zA-Z0-9]+$" }
      ]
    },
    "decimals": { "type": "integer", "minimum": 0, "maximum": 38 },
    "comment": { "type": "string", "maxLength": 150 }
  },
  "required": ["name", "org"],
  "anyOf": [
    { "required": ["contract"] },
    { "required": ["code", "issuer"] }
  ],
  "additionalProperties": false
};

function readJsonFile(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    throw new Error(`Failed to parse JSON from file: ${err.message}. This may be due to incorrect formatting or a syntax error in the JSON data.`);
  }
}

function writeJsonFile(filePath, data) {
  try {
    const jsonData = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, jsonData, 'utf8');
    console.log(`Successfully written data to ${filePath}`);
  } catch (err) {
    console.error(`Error writing file: ${err}`);
  }
}

function incrementVersion(version) {
  let [major, minor, patch] = version.split('.').map(num => parseInt(num, 10));

  // Increment version logic
  patch += 1;
  if (patch > 9) {
    patch = 0;
    minor += 1;
    if (minor > 9) {
      minor = 0;
      major += 1;
    }
  }

  major = Math.min(major, 999);

  return `${major}.${minor}.${patch}`;
}

async function mergeAndVerifyAssets(directoryPath, assetListPath) {
  const ajv = new Ajv();
  addFormats(ajv);
  const validate = ajv.compile(assetSchema);

  const existingAssetsList = readJsonFile(assetListPath);
  if (!existingAssetsList || !Array.isArray(existingAssetsList.assets)) {
    console.error(`Existing asset list is invalid or not found at ${assetListPath}`);
    return;
  }

  // Create a set of existing contract addresses for easy lookup
  const existingContractsSet = new Set(existingAssetsList.assets.map(asset => asset.contract));

  const assetsDir = path.join(__dirname, directoryPath);
  const assetFiles = fs.readdirSync(assetsDir).filter(file => path.extname(file) === '.json');

  // Set to track contracts that are still present in the directory
  const contractsInDirectory = new Set();

  let changesDetected = false;

  for (const file of assetFiles) {
    const filePath = path.join(assetsDir, file);
    const assetData = readJsonFile(filePath);
    if (!assetData) continue; // Skip files that couldn't be parsed

    contractsInDirectory.add(assetData.contract);

    if (!validate(assetData)) {
      console.error(`Asset validation failed for ${file}:`, validate.errors);
      continue; // Skip invalid assets
    }

    const existingAsset = existingAssetsList.assets.find(asset => asset.contract === assetData.contract);
    if (existingAsset) {
      // Check for changes if asset already exists
      const hasChanged = Object.keys(assetData).some(key => JSON.stringify(assetData[key]) !== JSON.stringify(existingAsset[key]));
      if (hasChanged) {
        console.log(`Changes detected for asset ${assetData.contract} in file ${file}`);
        changesDetected = true;
        // Update the existing asset with new data
        Object.assign(existingAsset, assetData);
      }
    } else {
      // New asset, indicate changes and it will be added later
      console.log(`Adding new asset from file ${file}`);
      changesDetected = true;
      existingAssetsList.assets.push(assetData);
    }
  }

  // Check for deletions by comparing existing contracts to those found in the directory
  const contractsToDelete = [...existingContractsSet].filter(contract => !contractsInDirectory.has(contract));
  if (contractsToDelete.length > 0) {
    console.log(`Removing deleted assets: ${contractsToDelete.join(', ')}`);
    changesDetected = true;
    existingAssetsList.assets = existingAssetsList.assets.filter(asset => !contractsToDelete.includes(asset.contract));
  }

  if (changesDetected) {
    const newVersion = incrementVersion(existingAssetsList.version);
    const updatedAssetsList = {
      ...existingAssetsList,
      version: newVersion,
      assets: existingAssetsList.assets.sort((a, b) => a.contract.localeCompare(b.contract))
    };

    writeJsonFile(assetListPath, updatedAssetsList);
  } else {
    console.log("------------------------------------");
    console.log("No new assets were added, changes detected, or assets deleted.");
    console.log("------------------------------------");
  }
}

// Update the paths as needed
mergeAndVerifyAssets('../assets', './tokenList.json');
