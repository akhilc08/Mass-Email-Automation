const { toSlug, uniqueSlug } = require('../src/utils/slug');

describe('toSlug', () => {
  test('lowercases and replaces spaces with hyphens', () => {
    expect(toSlug("Sakura Sushi Bar")).toBe("sakura-sushi-bar");
  });

  test('strips non-alphanumeric characters', () => {
    expect(toSlug("Joe's Pizza Ithaca")).toBe("joes-pizza-ithaca");
  });

  test('collapses consecutive hyphens', () => {
    expect(toSlug("A & B Co.")).toBe("a-b-co");
  });

  test('strips leading and trailing hyphens', () => {
    expect(toSlug("--test--")).toBe("test");
  });

  test('truncates to 60 characters', () => {
    const long = "A".repeat(70);
    expect(toSlug(long).length).toBeLessThanOrEqual(60);
  });
});

describe('uniqueSlug', () => {
  test('returns base slug when not taken', () => {
    const taken = new Set();
    expect(uniqueSlug("Sakura Sushi Bar", taken)).toBe("sakura-sushi-bar");
  });

  test('appends -2 when slug is taken', () => {
    const taken = new Set(["sakura-sushi-bar"]);
    expect(uniqueSlug("Sakura Sushi Bar", taken)).toBe("sakura-sushi-bar-2");
  });

  test('appends -3 when -2 is also taken', () => {
    const taken = new Set(["sakura-sushi-bar", "sakura-sushi-bar-2"]);
    expect(uniqueSlug("Sakura Sushi Bar", taken)).toBe("sakura-sushi-bar-3");
  });

  test('adds assigned slug to taken set', () => {
    const taken = new Set();
    const slug = uniqueSlug("Sakura Sushi Bar", taken);
    expect(taken.has(slug)).toBe(true);
  });
});
