import { dbGet, dbList } from './supabaseService.js';

export const listProjects = () => dbList('projects', { type: 'coupang' }, { order: 'created_at', ascending: true });
export const getProject = (id) => dbGet('projects', { id });
