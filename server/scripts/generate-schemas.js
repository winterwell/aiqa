const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const typesDir = path.join(__dirname, '../src/common/types');
const outputDir = path.join(__dirname, '../src/common/types');

// Types to generate schemas for (excluding index.ts)
// Note: Span is excluded because it extends ReadableSpan which contains function types
// that cannot be serialized to JSON schema. Span.schema.json is maintained manually.
const typeFiles = [
  { file: 'Organisation.ts', type: 'Organisation' },
  { file: 'User.ts', type: 'User' },
  { file: 'ApiKey.ts', type: 'ApiKey' },
  { file: 'Model.ts', type: 'Model' },
  { file: 'Dataset.ts', type: 'Dataset' },
  { file: 'Experiment.ts', type: 'Experiment' },
];

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

console.log('Generating JSON schemas for types...\n');

typeFiles.forEach(({ file, type }) => {
  const inputPath = path.join(typesDir, file);
  const outputPath = path.join(outputDir, `${type}.schema.json`);
  
  if (!fs.existsSync(inputPath)) {
    console.warn(`Warning: ${inputPath} does not exist, skipping...`);
    return;
  }

  try {
    console.log(`Generating schema for ${type}...`);
    const command = `ts-json-schema-generator --path "${inputPath}" --type ${type} --tsconfig "${path.join(__dirname, '../tsconfig.json')}"`;
    const schema = execSync(command, { encoding: 'utf-8', cwd: path.join(__dirname, '..') });
    fs.writeFileSync(outputPath, schema);
    console.log(`✓ Generated ${outputPath}\n`);
  } catch (error) {
    console.error(`✗ Error generating schema for ${type}:`, error.message);
    if (error.stdout) console.error('stdout:', error.stdout);
    if (error.stderr) console.error('stderr:', error.stderr);
  }
});

console.log('Schema generation complete!');

