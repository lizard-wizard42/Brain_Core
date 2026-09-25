import { Router, raw } from 'express';
import {
  createRememberNote,
  deleteRememberNote,
  listRememberNotes,
  updateRememberNote,
  rememberDay,
  rememberDays,
  rememberMonths,
  rememberStatus,
  rememberYears,
  startRemember,
  stopRemember,
  rememberSessions,
  rememberTranscript,
  rememberSearch,
  rememberVoiceprintGet,
  rememberVoiceprintPost,
  rememberVoiceprintDelete,
  rememberVoiceprintFromSession,
  rememberSegmentsSpeaker,
  rememberClusters,
  rememberPeople,
  rememberPeopleRename,
  rememberPeopleMerge,
  rememberPeopleDelete,
  rememberSegmentAudio,
  rememberBackfillSpeakers,
} from '../controllers/rememberController';

const router = Router();

router.get('/memory/status', rememberStatus);
router.post('/memory/start', startRemember);
router.post('/memory/stop', stopRemember);
router.get('/memory/years', rememberYears);
router.get('/memory/years/:year/months', rememberMonths);
router.get('/memory/years/:year/months/:month/days', rememberDays);
router.get('/memory/days/:date', rememberDay);
router.get('/memory/sessions', rememberSessions);
router.get('/memory/sessions/:sessionId/transcript', rememberTranscript);
router.get('/memory/search', rememberSearch);
router.get('/memory/voiceprint', rememberVoiceprintGet);
router.post('/memory/voiceprint', raw({ type: () => true, limit: '25mb' }), rememberVoiceprintPost);
router.delete('/memory/voiceprint', rememberVoiceprintDelete);
router.post('/memory/voiceprint/from-session/:sessionId', rememberVoiceprintFromSession);
router.patch('/memory/segments', rememberSegmentsSpeaker);
router.patch('/memory/clusters', rememberClusters);
router.get('/memory/people', rememberPeople);
router.post('/memory/people/merge', rememberPeopleMerge);
router.patch('/memory/people/:id', rememberPeopleRename);
router.delete('/memory/people/:id', rememberPeopleDelete);
router.get('/memory/segments/audio', rememberSegmentAudio);
router.get('/memory/segments/:id/audio', rememberSegmentAudio);
router.post('/memory/sessions/:sessionId/backfill-speakers', rememberBackfillSpeakers);

router.get('/', listRememberNotes);
router.post('/', createRememberNote);
router.patch('/:id', updateRememberNote);
router.delete('/:id', deleteRememberNote);

export default router;
