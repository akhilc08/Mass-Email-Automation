const rankContacts = require('../../src/contacts/ranker');

const makeContact = (title, confidence = 'high') => ({
  name: 'Test Person',
  title,
  email: 'test@example.com',
  source: 'apollo',
  confidence,
});

describe('rankContacts', () => {
  test('CEO ranks above General Manager', () => {
    const result = rankContacts([
      makeContact('General Manager'),
      makeContact('CEO'),
    ]);
    expect(result[0].title).toBe('CEO');
    expect(result[0].priority).toBe(1);
  });

  test('COO ranks above CMO', () => {
    const result = rankContacts([
      makeContact('CMO'),
      makeContact('COO'),
    ]);
    expect(result[0].title).toBe('COO');
    expect(result[0].priority).toBe(2);
  });

  test('Marketing Director ranks as priority 3', () => {
    const result = rankContacts([makeContact('Marketing Director')]);
    expect(result[0].priority).toBe(3);
  });

  test('General Manager ranks as priority 4', () => {
    const result = rankContacts([makeContact('General Manager')]);
    expect(result[0].priority).toBe(4);
  });

  test('VP of Finance ranks as priority 5', () => {
    const result = rankContacts([makeContact('VP of Finance')]);
    expect(result[0].priority).toBe(5);
  });

  test('unknown title ranks as priority 5', () => {
    const result = rankContacts([makeContact('Receptionist')]);
    expect(result[0].priority).toBe(5);
  });

  test('breaks ties by confidence: high > medium > low', () => {
    const result = rankContacts([
      makeContact('CEO', 'low'),
      makeContact('CEO', 'high'),
      makeContact('CEO', 'medium'),
    ]);
    expect(result[0].confidence).toBe('high');
    expect(result[1].confidence).toBe('medium');
    expect(result[2].confidence).toBe('low');
  });

  test('returns empty array for empty input', () => {
    expect(rankContacts([])).toEqual([]);
  });

  test('populates priority field on each contact', () => {
    const result = rankContacts([makeContact('Founder')]);
    expect(result[0]).toHaveProperty('priority', 1);
  });
});
