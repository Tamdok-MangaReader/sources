"use strict";

const NAME = "LANraragi";
const DEFAULT_PAGE_SIZE = 100;
const UTF8_BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const SORTS = [
  { value: "date_added", label: "Date added" },
  { value: "title", label: "Title" },
  { value: "lastread", label: "Last read" },
  { value: "artist", label: "Artist" },
];

const state = { pageSize: DEFAULT_PAGE_SIZE };

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function base64(text) {
  const bytes = [];
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += UTF8_BASE64[a >> 2];
    out += UTF8_BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? "=" : UTF8_BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? "=" : UTF8_BASE64[c & 63];
  }
  return out;
}

function serverUrl(ctx) {
  let url = trim(ctx.defaults.get("serverUrl", "http://localhost:3000"));
  if (!url) throw new Error("Set your LANraragi server URL in source settings.");
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, "");
}

function authHeaders(ctx) {
  const key = trim(ctx.defaults.get("apiKey", ""));
  return key ? { Authorization: `Bearer ${base64(key)}` } : {};
}

async function api(ctx, path) {
  const response = await ctx.request.fetch(`${serverUrl(ctx)}/api${path}`, {
    method: "GET",
    headers: { ...authHeaders(ctx), Accept: "application/json" },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error(`${NAME}: authorization failed. Check the API key in source settings.`);
  }
  if (response.status >= 400) throw new Error(`${NAME}: request failed (${response.status}) for ${path}`);
  return response.json();
}

function parseTags(raw) {
  const tags = [];
  for (const part of String(raw ?? "").split(",")) {
    const text = part.trim();
    if (!text) continue;
    const index = text.indexOf(":");
    if (index > 0) tags.push({ namespace: text.slice(0, index).trim().toLowerCase(), value: text.slice(index + 1).trim() });
    else tags.push({ namespace: "", value: text });
  }
  return tags;
}

function thumbnailUrl(ctx, id) {
  return `${serverUrl(ctx)}/api/archives/${id}/thumbnail`;
}

function toEntry(ctx, archive) {
  return {
    key: archive.arcid,
    title: archive.title || archive.filename || archive.arcid,
    cover: thumbnailUrl(ctx, archive.arcid),
    url: `${serverUrl(ctx)}/reader?id=${archive.arcid}`,
    status: "completed",
  };
}

async function search(ctx, { query, page, sort, ascending, category, newOnly, untaggedOnly }) {
  const pageNumber = Math.max(1, page ?? 1);
  const start = (pageNumber - 1) * state.pageSize;
  const params = [
    `filter=${encodeURIComponent(trim(query))}`,
    `start=${start}`,
    `sortby=${encodeURIComponent(sort ?? "date_added")}`,
    `order=${ascending ? "asc" : "desc"}`,
  ];
  if (category) params.push(`category=${encodeURIComponent(category)}`);
  if (newOnly) params.push("newonly=true");
  if (untaggedOnly) params.push("untaggedonly=true");
  const json = await api(ctx, `/search?${params.join("&")}`);
  const data = Array.isArray(json?.data) ? json.data : [];
  if (pageNumber === 1 && data.length > 0 && Number(json?.recordsFiltered) > data.length) {
    state.pageSize = data.length;
  }
  const total = Number(json?.recordsFiltered ?? 0);
  return {
    entries: data.map((archive) => toEntry(ctx, archive)),
    hasNextPage: start + data.length < total,
  };
}

async function fetchCategories(ctx) {
  try {
    const json = await api(ctx, "/categories");
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}

function resolvePagePath(ctx, path) {
  if (/^https?:\/\//i.test(path)) return path;
  const clean = path.replace(/^\.\//, "/").replace(/^(?!\/)/, "/");
  return `${serverUrl(ctx)}${clean}`;
}

const source = {
  async getListings(ctx) {
    const listings = [
      { id: "all", name: "All Archives", kind: "grid" },
      { id: "recent", name: "Recently Added", kind: "grid" },
      { id: "new", name: "New Archives", kind: "grid" },
      { id: "random", name: "Random", kind: "grid" },
    ];
    for (const category of await fetchCategories(ctx)) {
      listings.push({ id: `category:${category.id}`, name: category.name, kind: "grid" });
    }
    return listings;
  },

  async getFilters(ctx) {
    const filters = [
      {
        type: "sort",
        id: "sort",
        title: "Sort",
        options: SORTS.map((item) => item.label),
        default: 0,
        defaultAscending: false,
      },
      { type: "check", id: "newonly", title: "New archives only", default: false },
      { type: "check", id: "untaggedonly", title: "Untagged only", default: false },
    ];
    const categories = await fetchCategories(ctx);
    if (categories.length > 0) {
      filters.unshift({
        type: "select",
        id: "category",
        title: "Category",
        options: [
          { id: "", label: "All" },
          ...categories.map((item) => ({ id: item.id, label: item.name })),
        ],
      });
    }
    return filters;
  },

  async getHome(ctx) {
    const components = [];
    try {
      const recent = await search(ctx, { page: 1, sort: "date_added", ascending: false });
      if (recent.entries.length > 0) {
        components.push({
          kind: "scroller",
          title: "Recently Added",
          entries: recent.entries.slice(0, 15),
          listing: { id: "recent", name: "Recently Added" },
        });
      }
      const fresh = await search(ctx, { page: 1, sort: "date_added", ascending: false, newOnly: true });
      if (fresh.entries.length > 0) {
        components.push({
          kind: "scroller",
          title: "New Archives",
          entries: fresh.entries.slice(0, 15),
          listing: { id: "new", name: "New Archives" },
        });
      }
      try {
        const random = await api(ctx, "/search/random?count=15");
        const entries = (random?.data ?? []).map((archive) => toEntry(ctx, archive));
        if (entries.length > 0) {
          components.push({ kind: "scroller", title: "Random", entries });
        }
      } catch {}
      const categories = await fetchCategories(ctx);
      if (categories.length > 0) {
        components.push({
          kind: "filters",
          title: "Categories",
          entries: [],
          filterItems: categories.slice(0, 8).map((category) => ({
            title: category.name,
            filters: [{ type: "select", id: "category", value: category.id }],
          })),
        });
      }
      components.push({
        kind: "links",
        title: NAME,
        entries: [],
        links: [
          { title: "Open LANraragi", subtitle: serverUrl(ctx), url: serverUrl(ctx) },
          { title: "All archives", listing: { id: "all", name: "All Archives" } },
        ],
      });
    } catch (error) {
      components.push({
        kind: "links",
        title: "Setup",
        entries: [],
        links: [
          {
            title: "Configure LANraragi server",
            subtitle: error instanceof Error ? error.message : "Check source settings",
            url: "https://github.com/Difegue/LANraragi",
          },
        ],
      });
    }
    return { components };
  },

  async getSearchMangaList({ query, page, filters }, ctx) {
    const options = { query, page, sort: "date_added", ascending: false };
    for (const filter of filters ?? []) {
      if (filter.type === "sort") {
        options.sort = SORTS[filter.index ?? 0]?.value ?? "date_added";
        options.ascending = filter.ascending === true;
      } else if (filter.type === "select" && filter.id === "category") {
        options.category = filter.value;
      } else if (filter.type === "check" && filter.id === "newonly") {
        options.newOnly = filter.value === true;
      } else if (filter.type === "check" && filter.id === "untaggedonly") {
        options.untaggedOnly = filter.value === true;
      }
    }
    return search(ctx, options);
  },

  async getMangaList(listing, page, ctx) {
    const id = listing?.id ?? "";
    if (id === "all") return search(ctx, { page, sort: "title", ascending: true });
    if (id === "recent") return search(ctx, { page, sort: "date_added", ascending: false });
    if (id === "new") return search(ctx, { page, sort: "date_added", ascending: false, newOnly: true });
    if (id === "random") {
      const json = await api(ctx, "/search/random?count=30");
      return { entries: (json?.data ?? []).map((archive) => toEntry(ctx, archive)), hasNextPage: false };
    }
    if (id.startsWith("category:")) {
      return search(ctx, { page, sort: "date_added", ascending: false, category: id.slice("category:".length) });
    }
    return { entries: [], hasNextPage: false };
  },

  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) {
    const meta = await api(ctx, `/archives/${manga.key}/metadata`);
    const tags = parseTags(meta.tags);
    const valuesOf = (...namespaces) =>
      tags.filter((tag) => namespaces.includes(tag.namespace)).map((tag) => tag.value);
    const updated = { ...manga, ...toEntry(ctx, meta) };
    if (needsDetails) {
      const artists = valuesOf("artist");
      const groups = valuesOf("group", "circle");
      const authors = [...new Set([...groups, ...artists])];
      const details = [];
      if (meta.summary) details.push(meta.summary);
      const parodies = valuesOf("parody", "series");
      if (parodies.length) details.push(`Series: ${parodies.join(", ")}`);
      if (meta.pagecount) details.push(`Pages: ${meta.pagecount}`);
      Object.assign(updated, {
        description: details.join("\n\n") || undefined,
        authors: authors.length ? authors : undefined,
        artists: artists.length ? artists : undefined,
        tags: tags
          .filter((tag) => !["artist", "group", "circle", "date_added", "source"].includes(tag.namespace))
          .map((tag) => (tag.namespace ? `${tag.namespace}:${tag.value}` : tag.value)),
        viewer: "default",
      });
    }
    if (needsChapters) {
      const added = Number(valuesOf("date_added")[0]);
      updated.chapters = [
        {
          key: meta.arcid,
          title: meta.title || undefined,
          chapterNumber: 1,
          dateUploaded: Number.isFinite(added) && added > 0 ? added : undefined,
          url: `${serverUrl(ctx)}/reader?id=${meta.arcid}`,
        },
      ];
    }
    return updated;
  },

  async getPageList(manga, chapter, ctx) {
    const json = await api(ctx, `/archives/${chapter.key}/files`);
    const pages = Array.isArray(json?.pages) ? json.pages : [];
    if (pages.length === 0) throw new Error(`${NAME}: no pages found for this archive.`);
    const headers = authHeaders(ctx);
    const hasHeaders = Object.keys(headers).length > 0;
    return pages.map((path) => ({
      url: resolvePagePath(ctx, path),
      ...(hasHeaders ? { headers } : {}),
    }));
  },
};

if (typeof module !== "undefined") {
  module.exports = { source };
}
