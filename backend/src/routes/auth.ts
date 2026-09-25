import { Router } from 'express';
import {
  beginTwoFactorSetup,
  changePassword,
  completeInitialSetup,
  confirmTwoFactorSetup,
  disableTwoFactor,
  login,
  initialSetupStatus,
  logout,
  me,
  updateTelegramSettings,
  verifyLoginTwoFactor,
} from '../controllers/authController';
import { authMiddleware } from '../middleware/auth';
import { loginIpRateLimitMiddleware } from '../services/loginProtectionService';

const router = Router();

router.post('/login', loginIpRateLimitMiddleware, login);
router.get('/setup', initialSetupStatus);
router.post('/setup', loginIpRateLimitMiddleware, completeInitialSetup);
router.post('/login-2fa', loginIpRateLimitMiddleware, verifyLoginTwoFactor);
router.post('/logout', authMiddleware, logout);
router.get('/me', authMiddleware, me);
router.post('/change-password', authMiddleware, changePassword);
router.post('/telegram', authMiddleware, updateTelegramSettings);
router.post('/2fa/setup', authMiddleware, beginTwoFactorSetup);
router.post('/2fa/confirm', authMiddleware, confirmTwoFactorSetup);
router.post('/2fa/disable', authMiddleware, disableTwoFactor);

export default router;
