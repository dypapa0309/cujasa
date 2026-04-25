import { Router } from 'express';
import { getProject, listProjects } from '../services/projectService.js';

const router = Router();
router.get('/', async (req, res, next) => {
  try { res.json(await listProjects()); } catch (error) { next(error); }
});
router.get('/:id', async (req, res, next) => {
  try { res.json(await getProject(req.params.id)); } catch (error) { next(error); }
});
export default router;
