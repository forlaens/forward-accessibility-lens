export function getPageKey(tabId, url) {
  return `${tabId}:${url}`;
}

export function getPageScopedValue(map, tabId, url, fallback) {
  const exactKey = getPageKey(tabId, url);

  if (map.has(exactKey)) {
    return map.get(exactKey);
  }

  const prefix = `${tabId}:`;
  let latestValue = fallback;

  for (const [key, value] of map.entries()) {
    if (key.startsWith(prefix)) {
      latestValue = value;
    }
  }

  return latestValue;
}

export function migratePageScopedValue(map, tabId, url) {
  const nextKey = getPageKey(tabId, url);

  if (map.has(nextKey)) {
    return;
  }

  const currentValue = getPageScopedValue(map, tabId, url, undefined);

  if (currentValue !== undefined) {
    map.set(nextKey, currentValue);
  }
}
