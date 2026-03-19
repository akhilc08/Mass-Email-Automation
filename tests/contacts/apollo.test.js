const { parseApolloResponse } = require('../../src/contacts/apollo');

describe('parseApolloResponse', () => {
  const samplePeople = [
    {
      first_name: 'Kenji',
      last_name: 'Tanaka',
      title: 'Owner',
      email: 'kenji@sakurasushi.com',
      email_status: 'verified',
    },
    {
      first_name: 'Bob',
      last_name: null,
      title: 'Receptionist',
      email: null,
      email_status: null,
    },
    {
      first_name: 'Jane',
      last_name: 'Doe',
      title: 'CEO',
      email: 'jane@example.com',
      email_status: 'likely',
    },
  ];

  test('filters out contacts without email', () => {
    const result = parseApolloResponse({ people: samplePeople });
    expect(result.find(c => c.name === 'Bob')).toBeUndefined();
  });

  test('filters to leadership titles only', () => {
    const result = parseApolloResponse({ people: samplePeople });
    const names = result.map(c => c.name);
    expect(names).toContain('Kenji Tanaka');
    expect(names).toContain('Jane Doe');
    expect(names).not.toContain('Bob');
  });

  test('maps email_status verified to confidence high', () => {
    const result = parseApolloResponse({ people: samplePeople });
    const kenji = result.find(c => c.name === 'Kenji Tanaka');
    expect(kenji.confidence).toBe('high');
  });

  test('maps email_status likely to confidence medium', () => {
    const result = parseApolloResponse({ people: samplePeople });
    const jane = result.find(c => c.name === 'Jane Doe');
    expect(jane.confidence).toBe('medium');
  });

  test('sets source to apollo', () => {
    const result = parseApolloResponse({ people: samplePeople });
    result.forEach(c => expect(c.source).toBe('apollo'));
  });

  test('returns empty array for empty people list', () => {
    expect(parseApolloResponse({ people: [] })).toEqual([]);
  });

  test('returns empty array when people key is missing', () => {
    expect(parseApolloResponse({})).toEqual([]);
  });
});
