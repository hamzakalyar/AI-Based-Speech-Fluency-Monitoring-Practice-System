import api from './api';

export const sessionsService = {
  createSession: (audioBlob, metadata) => {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'session.wav');
    formData.append('metadata', JSON.stringify(metadata));

    return api.post('/sessions', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },

  analyzeSession: (audioBlob, passageId = null, expectedText = null) => {
    const formData = new FormData();
    // Use .webm extension to match the actual audio/webm;codecs=opus content recorded by MediaRecorder
    const ext = audioBlob.type?.includes('ogg') ? 'ogg' : audioBlob.type?.includes('mp4') ? 'mp4' : 'webm';
    formData.append('audio', audioBlob, `session.${ext}`);
    if (passageId) formData.append('passageId', passageId);
    if (expectedText) formData.append('expectedText', expectedText);

    return api.post('/sessions/analyze', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: 180000, // 3-minute timeout — Whisper can be slow on free Render tier
    });
  },

  getSessions: (params) => api.get('/sessions', { params }),
  
  getSessionById: (id) => api.get(`/sessions/${id}`),
  
  deleteSession: (id) => api.delete(`/sessions/${id}`),

  getPassages: () => api.get('/assessment-passages'),
  getPassageById: (id) => api.get(`/assessment-passages/${id}`),
};

