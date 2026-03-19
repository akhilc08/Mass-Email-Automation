function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function uniqueSlug(companyName, takenSet) {
  const base = toSlug(companyName);
  let slug = base;
  let counter = 2;
  while (takenSet.has(slug)) {
    slug = `${base}-${counter}`;
    counter++;
  }
  takenSet.add(slug);
  return slug;
}

module.exports = { toSlug, uniqueSlug };
