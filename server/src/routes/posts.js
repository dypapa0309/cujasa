import { Router } from 'express';
import { generatePosts, listPosts } from '../services/contentService.js';
import { generateCtas } from '../services/ctaService.js';

const router = Router();
router.post('/:topicId/generate-posts', async (req, res, next) => {
  try {
    const posts = await generatePosts(req.params.topicId);
    for (const post of posts) await generateCtas(post.id);
    res.status(201).json(posts);
  } catch (e) { next(e); }
});
router.get('/:accountId/posts', async (req, res, next) => {
  try { res.json(await listPosts(req.params.accountId)); } catch (e) { next(e); }
});
export default router;
