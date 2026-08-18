import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcesDir = join(root, 'sources');
const staticDir = join(root, 'static');
const publicDir = join(root, 'public');
const outSourcesDir = join(publicDir, 'sources');
const outIconsDir = join(publicDir, 'icons');

mkdirSync(outSourcesDir, { recursive: true });
mkdirSync(outIconsDir, { recursive: true });

if (existsSync(staticDir)) {
  for (const entry of readdirSync(staticDir, { withFileTypes: true })) {
    const from = join(staticDir, entry.name);
    const to = join(publicDir, entry.name);
    if (entry.isDirectory()) {
      cpSync(from, to, { recursive: true });
    } else {
      cpSync(from, to);
    }
  }
}

const registry = {
  name: 'Tamdok Community Sources',
  sources: [],
};

for (const folder of readdirSync(sourcesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
  if (folder.name === 'template') continue;

  const sourcePath = join(sourcesDir, folder.name);
  const manifest = JSON.parse(readFileSync(join(sourcePath, 'source.json'), 'utf8'));
  const script = readFileSync(join(sourcePath, 'index.js'), 'utf8');
  const files = {
    'Payload/source.json': new TextEncoder().encode(JSON.stringify(manifest)),
    'Payload/index.js': new TextEncoder().encode(script),
  };

  if (Array.isArray(manifest.settings) && manifest.settings.length > 0) {
    files['Payload/settings.json'] = new TextEncoder().encode(JSON.stringify(manifest.settings));
  }

  const filtersPath = join(sourcePath, 'filters.json');
  if (existsSync(filtersPath)) {
    files['Payload/filters.json'] = readFileSync(filtersPath);
  }

  const iconPath = join(sourcePath, 'icon.png');
  let iconURL;
  if (existsSync(iconPath)) {
    const iconBytes = readFileSync(iconPath);
    files['Payload/icon.png'] = iconBytes;
    const iconFileName = `${manifest.info.id}-v${manifest.info.version}.png`;
    writeFileSync(join(outIconsDir, iconFileName), iconBytes);
    iconURL = `icons/${iconFileName}`;
  }

  const pkgName = `${manifest.info.id}-v${manifest.info.version}.tamdok`;
  writeFileSync(join(outSourcesDir, pkgName), zipSync(files));

  registry.sources.push({
    id: manifest.info.id,
    name: manifest.info.name,
    version: manifest.info.version,
    ...(iconURL ? { iconURL } : {}),
    downloadURL: `sources/${pkgName}`,
    languages: manifest.info.languages,
    contentRating: manifest.info.contentRating ?? 0,
    baseURL: manifest.info.url,
    minAppVersion: manifest.info.minAppVersion,
  });
}

writeFileSync(join(publicDir, 'index.min.json'), JSON.stringify(registry));
console.log(`Built ${registry.sources.length} Tamdok sources`);
