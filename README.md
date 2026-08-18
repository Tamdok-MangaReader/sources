# Tamdok Sources

JavaScript sources for [Tamdok](https://github.com/Tamdok-MangaReader/Tamdok). Same idea as [Aidoku Community Sources](https://github.com/Aidoku-Community/sources), but sources run as plain JavaScript and ship as `.tamdok` packages.

Tamdok also supports Aidoku `.aix` (Rust/WASM) sources from the Aidoku registry.

## Community sources

Community sources can be found [here](https://github.com/Tamdok-MangaReader/sources-community)

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