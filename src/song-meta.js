export const songArtist = song => typeof song?.artist === 'string' ? song.artist.trim() : '';
export const reviewSongMeta = song => [songArtist(song),`${Math.round(song.bpm)} BPM`].filter(Boolean).join(' · ');
