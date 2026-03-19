const { parseHunterResponse } = require('../../src/contacts/hunter');

describe('parseHunterResponse', () => {
  const sampleData = {
    data: {
      emails: [
        {
          first_name: 'Alice',
          last_name: 'Smith',
          position: 'CEO',
          value: 'alice@example.com',
          confidence: 92,
        },
        {
          first_name: 'Bob',
          last_name: 'Jones',
          position: 'Accountant',
          value: 'bob@example.com',
          confidence: 50,
        },
        {
          first_name: null,
          last_name: null,
          position: 'Owner',
          value: 'owner@example.com',
          confidence: 70,
        },
      ],
    },
  };

  test('filters to leadership titles', () => {
    const result = parseHunterResponse(sampleData);
    const positions = result.map(c => c.title);
    expect(positions).toContain('CEO');
    expect(positions).toContain('Owner');
    expect(positions).not.toContain('Accountant');
  });

  test('maps confidence score >= 80 to high', () => {
    const result = parseHunterResponse(sampleData);
    const alice = result.find(c => c.email === 'alice@example.com');
    expect(alice.confidence).toBe('high');
  });

  test('maps confidence score 50–79 to medium', () => {
    const result = parseHunterResponse(sampleData);
    const owner = result.find(c => c.email === 'owner@example.com');
    expect(owner.confidence).toBe('medium');
  });

  test('handles missing name gracefully', () => {
    const result = parseHunterResponse(sampleData);
    const owner = result.find(c => c.email === 'owner@example.com');
    expect(owner.name).toBe('');
  });

  test('sets source to hunter', () => {
    const result = parseHunterResponse(sampleData);
    result.forEach(c => expect(c.source).toBe('hunter'));
  });

  test('returns empty array for empty emails', () => {
    expect(parseHunterResponse({ data: { emails: [] } })).toEqual([]);
  });
});
