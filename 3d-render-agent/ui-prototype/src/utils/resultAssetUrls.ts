type AssetUrlQuery = Record<string, string | number | boolean | undefined>;

type AssetUrlBuilder = (path: string, query?: AssetUrlQuery) => string;

export function shouldIncludeResultNamespaceQuery(userId = "default") {
  return userId === "default";
}

export function resolveResultAssetUrl(
  value: string | null | undefined,
  userId: string | null | undefined,
  includeNamespaceQuery: boolean,
  buildUrl: AssetUrlBuilder,
) {
  if (!value) return undefined;
  if (value.startsWith("data:") || value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  return buildUrl(value, includeNamespaceQuery && userId ? { user_id: userId } : undefined);
}
