import { dbGet, dbInsert, dbList, dbUpdate, supabase } from './supabaseService.js';
import { addHours, iso } from '../utils/date.js';

export async function createMetricJobs(queue) {
  const snapshots = [{ type: '24h', hours: 24 }, { type: '72h', hours: 72 }, { type: '7d', hours: 168 }];
  const jobs = [];
  for (const snapshot of snapshots) {
    jobs.push(await dbInsert('post_metrics_jobs', {
      post_id: queue.post_id,
      queue_id: queue.id,
      account_id: queue.account_id,
      project_id: queue.project_id,
      platform: queue.platform,
      post_url: queue.post_url,
      snapshot_type: snapshot.type,
      scheduled_at: addHours(queue.posted_at || new Date(), snapshot.hours).toISOString(),
      status: 'pending'
    }));
  }
  return jobs;
}

export async function runDueMetricJobs() {
  const jobs = await dbList('post_metrics_jobs', { status: 'pending' });
  const due = jobs.filter((job) => new Date(job.scheduled_at) <= new Date());
  for (const job of due) await runMetricJob(job.id);
  return due.length;
}

export async function runMetricJob(jobId) {
  const job = await dbGet('post_metrics_jobs', { id: jobId });
  if (!job) return null;
  await dbUpdate('post_metrics_jobs', { id: jobId }, { status: 'running' });
  const queue = await dbGet('post_queue', { id: job.queue_id });
  const clicks = supabase
    ? (await supabase.from('click_events').select('id', { count: 'exact', head: true }).eq('post_id', job.post_id)).count || 0
    : (await dbList('click_events', { post_id: job.post_id })).length;
  const hours = job.snapshot_type === '24h' ? 24 : job.snapshot_type === '72h' ? 72 : 168;
  await dbInsert('post_metrics', {
    project_id: job.project_id,
    account_id: job.account_id,
    topic_id: queue?.topic_id,
    post_id: job.post_id,
    product_id: null,
    cta_variant_id: queue?.selected_cta_id,
    measured_at: iso(),
    hours_after_post: hours,
    impressions: null,
    likes: null,
    comments: null,
    clicks,
    revenue: null,
    source: 'tracking'
  });
  const [updated] = await dbUpdate('post_metrics_jobs', { id: jobId }, { status: 'completed', executed_at: iso() });
  return updated;
}
