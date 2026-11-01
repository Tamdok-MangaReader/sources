# Tamdok Sources

JavaScript sources for [Tamdok](https://github.com/Tamdok-MangaReader/Tamdok). Same idea as [Aidoku Community Sources](https://github.com/Aidoku-Community/sources), but sources run as plain JavaScript and ship as `.tamdok` packages.

Tamdok also supports Aidoku `.aix` (Rust/WASM) sources from the Aidoku registry.

## Community sources

Community sources can be found [here](https://github.com/Tamdok-MangaReader/sources-community)

Browse every official and community source on one page: [tamdok-mangareader.github.io/sources-community](https://tamdok-mangareader.github.io/sources-community/)

## Add sources in Tamdok

<p align="center">
  <a href="https://tamdok-mangareader.github.io/sources/open.html">
    <img src="https://img.shields.io/badge/Open%20in%20Tamdok-Add%20registry-0A84FF?style=for-the-badge" alt="Open in Tamdok" />
  </a>
</p>

Tap the button on your iPhone to open Tamdok. The app opens **Settings → Sources** and asks you to confirm adding this registry.

GitHub does not allow `tamdok://` links in README markdown, so the button opens an HTTPS redirect page that launches the app.

Registry URL:

```
https://tamdok-mangareader.github.io/sources/index.min.json
```

Deep link (same action):

```
tamdok://settings/sources?registry=https%3A%2F%2Ftamdok-mangareader.github.io%2Fsources%2Findex.min.json
```


Or import a `.tamdok` file from Settings → Sources.

## Types

`types/tamdok.d.ts` describes the source API (`TamdokSourceModule`, `ctx`, `Manga`, `Chapter`, filters, home layout). Every source annotates its `source` object with it:

```javascript
/** @type {import("../../types/tamdok").TamdokSourceModule} */
const source = { /* ... */ };
```

This gives editor autocomplete and lets you check all sources at once:

```bash
npm run typecheck
```

`npm run check` validates manifests and scripts (required `info` fields, unique ids, valid `filters.json`, JavaScript syntax) and `npm run verify` runs both. They also run on GitHub Actions for every pull request and before each deploy. The annotation is a comment and the types are not included in `.tamdok` packages. The check is lenient (`strict: false`). Details: [API reference](https://github.com/Tamdok-MangaReader/sources-community/wiki/API-reference#types).
