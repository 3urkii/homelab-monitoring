function validateTvConfig(tv, hasHomeAssistant) {
  const errors = [];
  if (!tv || typeof tv !== 'object') {
    errors.push('tv must be an object');
    return errors;
  }
  if (!hasHomeAssistant) errors.push('tv requires homeAssistant');
  if (typeof tv.powerEntity !== 'string' || !tv.powerEntity.startsWith('media_player.')) {
    errors.push('tv.powerEntity must be a media_player.* entity_id');
  }
  if (typeof tv.volumeEntity !== 'string' || !tv.volumeEntity.startsWith('media_player.')) {
    errors.push('tv.volumeEntity must be a media_player.* entity_id');
  }
  if (!Array.isArray(tv.shortcuts) || tv.shortcuts.length === 0) {
    errors.push('tv.shortcuts must be a non-empty array');
  } else {
    const ids = new Set();
    for (const [i, s] of tv.shortcuts.entries()) {
      if (!s || typeof s !== 'object') {
        errors.push(`tv.shortcuts[${i}] must be an object`);
        continue;
      }
      if (typeof s.id !== 'string' || !s.id) errors.push(`tv.shortcuts[${i}].id required`);
      else if (ids.has(s.id)) errors.push(`tv.shortcuts[${i}].id duplicate: ${s.id}`);
      else ids.add(s.id);
      if (typeof s.label !== 'string' || !s.label) errors.push(`tv.shortcuts[${i}].label required`);
      if (typeof s.entity !== 'string' || !s.entity.startsWith('media_player.')) {
        errors.push(`tv.shortcuts[${i}].entity must be a media_player.* entity_id`);
      }
      if (typeof s.source !== 'string' || !s.source) errors.push(`tv.shortcuts[${i}].source required`);
      if (s.icon !== undefined && (typeof s.icon !== 'string' || !s.icon)) {
        errors.push(`tv.shortcuts[${i}].icon must be a non-empty string if set`);
      }
    }
  }
  return errors;
}

function trackedEntitiesFromTv(tv) {
  const set = new Set();
  if (!tv) return set;
  if (tv.powerEntity) set.add(tv.powerEntity);
  if (tv.volumeEntity) set.add(tv.volumeEntity);
  for (const s of tv.shortcuts || []) {
    if (s?.entity) set.add(s.entity);
  }
  return set;
}

function resolveShortcut(shortcuts, id) {
  const found = (shortcuts || []).find((s) => s.id === id);
  if (!found) {
    const err = new Error(`unknown shortcut id: ${id}`);
    err.code = 'unknown_shortcut';
    throw err;
  }
  return { entity: found.entity, source: found.source };
}

function buildTvSnapshot(tv, haClient) {
  const shortcutsBase = tv.shortcuts.map((s) => ({
    id: s.id,
    label: s.label,
    icon: s.icon || null,
    active: false,
  }));
  if (!haClient.isConnected()) {
    return { connected: false, power: null, volume: null, shortcuts: shortcutsBase };
  }
  const powerState = haClient.getMediaPlayerState(tv.powerEntity);
  const volumeState = haClient.getMediaPlayerState(tv.volumeEntity);
  const sourceByEntity = new Map();
  for (const s of tv.shortcuts) {
    if (!sourceByEntity.has(s.entity)) {
      const st = haClient.getMediaPlayerState(s.entity);
      sourceByEntity.set(s.entity, st?.source ?? null);
    }
  }
  return {
    connected: true,
    power: powerState
      ? { entity_id: tv.powerEntity, on: powerState.on, source: powerState.source }
      : null,
    volume: volumeState
      ? {
          entity_id: tv.volumeEntity,
          muted: volumeState.is_volume_muted,
          level: volumeState.volume_level,
          source: volumeState.source,
        }
      : null,
    shortcuts: tv.shortcuts.map((s) => ({
      id: s.id,
      label: s.label,
      icon: s.icon || null,
      active: sourceByEntity.get(s.entity) === s.source,
    })),
  };
}

module.exports = { validateTvConfig, trackedEntitiesFromTv, resolveShortcut, buildTvSnapshot };
