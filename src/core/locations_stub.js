// Minimal in-memory stub for locations
export function get_locations() {
  return [
    { id: 'loc1', name: 'さくらクリニック', phone: '03-1111-1111', address: '東京都千代田区1-1-1', hours: '9:00-18:00', url: 'https://example.com/loc1' },
    { id: 'loc2', name: 'ひまわり医院', phone: '03-2222-2222', address: '東京都港区2-2-2', hours: '10:00-19:00', url: 'https://example.com/loc2' },
    { id: 'loc3', name: 'つばき内科', phone: '03-3333-3333', address: '東京都新宿区3-3-3', hours: '9:30-17:30', url: 'https://example.com/loc3' },
    { id: 'loc4', name: 'もみじ歯科', phone: '03-4444-4444', address: '東京都渋谷区4-4-4', hours: '9:00-13:00/15:00-18:00', url: 'https://example.com/loc4' },
    { id: 'loc5', name: 'あおば皮膚科', phone: '03-5555-5555', address: '東京都文京区5-5-5', hours: '10:00-18:00', url: 'https://example.com/loc5' },
  ];
}

export function get_location(id) {
  return get_locations().find((l) => l.id === id) || null;
}

