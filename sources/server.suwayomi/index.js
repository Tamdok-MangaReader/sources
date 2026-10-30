"use strict";

const PAGE_SIZE = 30;
const NAME = "Suwayomi";

const SORTS = [
  { field: "TITLE", label: "Title" },
  { field: "IN_LIBRARY_AT", label: "Date added to library" },
  { field: "LAST_FETCHED_AT", label: "Last updated" },
  { field: "ID", label: "ID" },
];

const STATUS_MAP = {
  ONGOING: "ongoing",
  COMPLETED: "completed",
  PUBLISHING_FINISHED: "completed",
  LICENSED: "completed",
  CANCELLED: "cancelled",
  ON_HIATUS: "hiatus",
};

const MANGA_FIELDS = "id title thumbnailUrl status";
const DETAIL_FIELDS =
  "id title thumbnailUrl status author artist description genre url realUrl";

const UTF8_BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function utf8Bytes(text) {
  const bytes = [];
  for (const char of text) {
    let code = char.codePointAt(0);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      );
    }
  }
  return bytes;
}

function base64(text) {
  const bytes = utf8Bytes(text);
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

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function serverUrl(ctx) {
  let url = trim(ctx.defaults.get("serverUrl", "http://localhost:4567"));
  if (!url) throw new Error("Set your Suwayomi server URL in source settings.");
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, "");
}

function authHeaders(ctx) {
  const headers = {};
  const username = trim(ctx.defaults.get("username", ""));
  const password = ctx.defaults.get("password", "");
  if (username && password) headers.Authorization = `Basic ${base64(`${username}:${password}`)}`;
  return headers;
}

function absolute(ctx, path) {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return `${serverUrl(ctx)}${path.startsWith("/") ? "" : "/"}${path}`;
}

async function gql(ctx, query, variables = {}) {
  const response = await ctx.request.fetch(`${serverUrl(ctx)}/api/graphql`, {
    method: "POST",
    headers: { ...authHeaders(ctx), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error(`${NAME}: authentication failed. Check username and password in source settings.`);
  }
  if (response.status >= 400) throw new Error(`${NAME}: request failed (${response.status})`);
  const json = await response.json();
  if (json?.errors?.length) {
    throw new Error(`${NAME}: ${json.errors.map((item) => item.message).join("; ")}`);
  }
  if (!json?.data) throw new Error(`${NAME}: empty response`);
  return json.data;
}

function toEntry(ctx, node) {
  return {
    key: String(node.id),
    title: node.title,
    cover: absolute(ctx, node.thumbnailUrl),
    status: STATUS_MAP[node.status] ?? "unknown",
  };
}

function seconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  return Math.floor(number > 1e11 ? number / 1000 : number);
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

async function listLibrary(ctx, { query, page, sort, ascending }) {
  const offset = (Math.max(1, page) - 1) * PAGE_SIZE;
  const filter = { inLibrary: { equalTo: true } };
  if (trim(query)) filter.title = { includesInsensitive: trim(query) };
  const data = await gql(
    ctx,
    `query($filter: MangaFilterInput, $orderBy: MangaOrderBy, $orderByType: SortOrder, $first: Int, $offset: Int) {
      mangas(filter: $filter, orderBy: $orderBy, orderByType: $orderByType, first: $first, offset: $offset) {
        nodes { ${MANGA_FIELDS} }
        pageInfo { hasNextPage }
      }
    }`,
    {
      filter,
      orderBy: sort,
      orderByType: ascending ? "ASC" : "DESC",
      first: PAGE_SIZE,
      offset,
    },
  );
  const list = data.mangas;
  return {
    entries: (list?.nodes ?? []).map((node) => toEntry(ctx, node)),
    hasNextPage: Boolean(list?.pageInfo?.hasNextPage),
  };
}

async function fetchCategories(ctx) {
  try {
    const data = await gql(ctx, "query { categories { nodes { id name } } }");
    return (data.categories?.nodes ?? []).filter((item) => item.id !== 0 || item.name);
  } catch {
    return [];
  }
}

async function listCategory(ctx, categoryId) {
  const data = await gql(
    ctx,
    `query($id: Int!) { category(id: $id) { mangas { nodes { ${MANGA_FIELDS} } } } }`,
    { id: Number(categoryId) },
  );
  return {
    entries: (data.category?.mangas?.nodes ?? []).map((node) => toEntry(ctx, node)),
    hasNextPage: false,
  };
}

const CHAPTER_FIELDS = "id name chapterNumber scanlator uploadDate sourceOrder realUrl";

function toChapter(node) {
  const chapterNumber = positive(node.chapterNumber);
  return {
    key: String(node.id),
    title: node.name || undefined,
    chapterNumber,
    dateUploaded: seconds(node.uploadDate),
    scanlators: node.scanlator ? [node.scanlator] : undefined,
    url: node.realUrl || undefined,
  };
}

async function loadChapters(ctx, mangaId) {
  const data = await gql(
    ctx,
    `query($id: Int!) {
      chapters(condition: { mangaId: $id }, orderBy: SOURCE_ORDER, orderByType: DESC) {
        nodes { ${CHAPTER_FIELDS} }
      }
    }`,
    { id: Number(mangaId) },
  );
  let nodes = data.chapters?.nodes ?? [];
  if (nodes.length === 0) {
    try {
      const fetched = await gql(
        ctx,
        `mutation($id: Int!) { fetchChapters(input: { mangaId: $id }) { chapters { ${CHAPTER_FIELDS} } } }`,
        { id: Number(mangaId) },
      );
      nodes = [...(fetched.fetchChapters?.chapters ?? [])].sort(
        (a, b) => (b.sourceOrder ?? 0) - (a.sourceOrder ?? 0),
      );
    } catch {
      nodes = [];
    }
  }
  return nodes.map(toChapter);
}

const source = {
  async getListings(ctx) {
    const listings = [
      { id: "library", name: "Library", kind: "grid" },
      { id: "recent", name: "Recently Added", kind: "grid" },
      { id: "updated", name: "Recently Updated", kind: "grid" },
    ];
    for (const category of await fetchCategories(ctx)) {
      if (category.id === 0) continue;
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
        defaultAscending: true,
      },
    ];
    const categories = (await fetchCategories(ctx)).filter((item) => item.id !== 0);
    if (categories.length > 0) {
      filters.unshift({
        type: "select",
        id: "category",
        title: "Category",
        options: [
          { id: "", label: "All" },
          ...categories.map((item) => ({ id: String(item.id), label: item.name })),
        ],
      });
    }
    return filters;
  },

  async getHome(ctx) {
    const components = [];
    try {
      const recent = await listLibrary(ctx, { page: 1, sort: "IN_LIBRARY_AT", ascending: false });
      if (recent.entries.length > 0) {
        components.push({
          kind: "scroller",
          title: "Recently Added",
          entries: recent.entries.slice(0, 12),
          listing: { id: "recent", name: "Recently Added" },
        });
      }
      const updated = await listLibrary(ctx, { page: 1, sort: "LAST_FETCHED_AT", ascending: false });
      if (updated.entries.length > 0) {
        components.push({
          kind: "scroller",
          title: "Recently Updated",
          entries: updated.entries.slice(0, 12),
          listing: { id: "updated", name: "Recently Updated" },
        });
      }
      const categories = (await fetchCategories(ctx)).filter((item) => item.id !== 0);
      if (categories.length > 0) {
        components.push({
          kind: "filters",
          title: "Categories",
          entries: [],
          filterItems: categories.slice(0, 8).map((category) => ({
            title: category.name,
            filters: [{ type: "select", id: "category", value: String(category.id) }],
          })),
        });
      }
      components.push({
        kind: "links",
        title: NAME,
        entries: [],
        links: [
          { title: "Open Suwayomi", subtitle: serverUrl(ctx), url: serverUrl(ctx) },
          { title: "Library", listing: { id: "library", name: "Library" } },
        ],
      });
    } catch (error) {
      components.push({
        kind: "links",
        title: "Setup",
        entries: [],
        links: [
          {
            title: "Configure Suwayomi server",
            subtitle: error instanceof Error ? error.message : "Check source settings",
            url: "https://github.com/Suwayomi/Suwayomi-Server",
          },
        ],
      });
    }
    return { components };
  },

  async getSearchMangaList({ query, page, filters }, ctx) {
    let sort = "TITLE";
    let ascending = true;
    let category = "";
    for (const filter of filters ?? []) {
      if (filter.type === "sort") {
        sort = SORTS[filter.index ?? 0]?.field ?? "TITLE";
        ascending = filter.ascending !== false;
      } else if (filter.type === "select" && filter.id === "category") {
        category = filter.value;
      }
    }
    if (category && !trim(query)) return listCategory(ctx, category);
    return listLibrary(ctx, { query, page: page ?? 1, sort, ascending });
  },

  async getMangaList(listing, page, ctx) {
    const id = listing?.id ?? "";
    if (id === "library") {
      return listLibrary(ctx, { page, sort: "TITLE", ascending: true });
    }
    if (id === "recent") {
      return listLibrary(ctx, { page, sort: "IN_LIBRARY_AT", ascending: false });
    }
    if (id === "updated") {
      return listLibrary(ctx, { page, sort: "LAST_FETCHED_AT", ascending: false });
    }
    if (id.startsWith("category:")) return listCategory(ctx, id.slice("category:".length));
    return { entries: [], hasNextPage: false };
  },

  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) {
    const updated = { ...manga };
    const tasks = [];
    if (needsDetails) {
      tasks.push(
        gql(ctx, `query($id: Int!) { manga(id: $id) { ${DETAIL_FIELDS} } }`, {
          id: Number(manga.key),
        }).then((data) => {
          const node = data.manga;
          if (!node) throw new Error(`${NAME}: title not found`);
          Object.assign(updated, {
            title: node.title,
            cover: absolute(ctx, node.thumbnailUrl),
            description: node.description || undefined,
            authors: node.author ? [node.author] : undefined,
            artists: node.artist && node.artist !== node.author ? [node.artist] : undefined,
            tags: node.genre?.length ? node.genre : undefined,
            status: STATUS_MAP[node.status] ?? "unknown",
            url: node.realUrl || node.url ? node.realUrl || node.url : undefined,
          });
        }),
      );
    }
    if (needsChapters) {
      tasks.push(
        loadChapters(ctx, manga.key).then((chapters) => {
          updated.chapters = chapters;
        }),
      );
    }
    await Promise.all(tasks);
    return updated;
  },

  async getPageList(manga, chapter, ctx) {
    const data = await gql(
      ctx,
      `mutation($id: Int!) { fetchChapterPages(input: { chapterId: $id }) { pages } }`,
      { id: Number(chapter.key) },
    );
    const pages = data.fetchChapterPages?.pages ?? [];
    if (pages.length === 0) throw new Error(`${NAME}: no pages found for this chapter.`);
    const headers = authHeaders(ctx);
    const hasHeaders = Object.keys(headers).length > 0;
    return pages.map((path) => ({
      url: absolute(ctx, path),
      ...(hasHeaders ? { headers } : {}),
    }));
  },
};

if (typeof module !== "undefined") {
  module.exports = { source };
}
