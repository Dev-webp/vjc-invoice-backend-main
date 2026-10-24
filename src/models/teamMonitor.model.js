const pool = require('../config/db');

// range -> [fromDaysBack, toDaysBack]. All values are hardcoded numbers, never user text.
const RANGES = {
  today: [0, 0],
  yesterday: [1, 1],
  '7d': [6, 0],
};

// staffId = null  -> chairman / mis-executive view (everything)
// staffId = <id>  -> employee view (only that person's leads, flags, workload)
const getTeamMonitor = async (rangeKey, staffId = null) => {
  const key = RANGES[rangeKey] ? rangeKey : 'today';
  const [from, to] = RANGES[key];
  const len = from - to + 1;
  const pFrom = from + len;
  const pTo = to + len;
  const sid = staffId === null || staffId === undefined ? null : String(staffId);
  const scoped = sid !== null;
  const R = [from, to];          // 2 params, for queries that are never scoped
  const R3 = [from, to, sid];    // 3 params, for queries that use scope()

  const inRange = (col) => `${col}::date BETWEEN CURRENT_DATE - $1::int AND CURRENT_DATE - $2::int`;
  const scope = (col) => `($3::text IS NULL OR ${col}::text = $3::text)`;

  const summarySql = `
    SELECT
      COUNT(*)::int AS received,
      COUNT(*) FILTER (WHERE l.assigned_to IS NOT NULL)::int AS assigned,
      COUNT(*) FILTER (WHERE l.assigned_to IS NOT NULL AND EXISTS (
        SELECT 1 FROM lead_notes n
        WHERE n.lead_id = l.id AND n.commented_by = l.assigned_to
          AND (l.assigned_at IS NULL OR n.created_at > l.assigned_at)
      ))::int AS contacted,
      COUNT(*) FILTER (WHERE l.status IN ('Warm','Prospect'))::int AS warm_prospect,
      COUNT(*) FILTER (WHERE l.status = 'Pending Agreement')::int AS pending_agreement,
      COUNT(*) FILTER (WHERE l.status = 'Closed')::int AS closed
    FROM leads l
    WHERE ${inRange('l.created_at')} AND ${scope('l.assigned_to')}`;

  const [
    summary, prevSummary, pending, flagCount, shuffled, staffCounts,
    agents, agentStats, agentFlags, openLeads, flagFeed,
    byDept, bySource, byHour,
  ] = await Promise.all([
    pool.query(summarySql, R3),
    pool.query(summarySql, [pFrom, pTo, sid]),
    pool.query(`SELECT COUNT(*)::int AS count,
                       COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) / 60, 0)::int AS oldest_min
                FROM leads WHERE assigned_to IS NULL`),
    pool.query(`SELECT COUNT(*)::int AS count FROM agent_red_flags
                WHERE ${inRange('flag_date')} AND ${scope('staff_id')}`, R3),
    pool.query(`SELECT COUNT(*)::int AS count FROM lead_assignment_history
                WHERE reason = 'auto_shuffle_sla_breach' AND ${inRange('assigned_date')}`, R),
    pool.query(`SELECT COUNT(DISTINCT staff_id)::int AS total,
                       COUNT(DISTINCT staff_id) FILTER (WHERE is_online = true)::int AS online
                FROM department_staff`),
    pool.query(`SELECT ds.staff_id AS id, u.name, MIN(d.name) AS department,
                       BOOL_OR(ds.is_online) AS is_online
                FROM department_staff ds
                JOIN users u ON u.id = ds.staff_id
                LEFT JOIN departments d ON d.id = ds.department_id
                GROUP BY ds.staff_id, u.name
                ORDER BY u.name`),
    pool.query(`SELECT l.assigned_to AS id, COUNT(*)::int AS leads,
                       ROUND(AVG(EXTRACT(EPOCH FROM (fn.first_note - l.assigned_at)) / 60))::int AS avg_reply_min
                FROM leads l
                LEFT JOIN LATERAL (
                  SELECT MIN(n.created_at) AS first_note FROM lead_notes n
                  WHERE n.lead_id = l.id AND n.commented_by = l.assigned_to
                    AND n.created_at > l.assigned_at
                ) fn ON true
                WHERE l.assigned_to IS NOT NULL AND ${inRange('l.created_at')} AND ${scope('l.assigned_to')}
                GROUP BY l.assigned_to`, R3),
    pool.query(`SELECT staff_id AS id, COUNT(*)::int AS flags FROM agent_red_flags
                WHERE ${inRange('flag_date')} AND ${scope('staff_id')} GROUP BY staff_id`, R3),
    pool.query(`SELECT l.id AS lead_id, l.lead_name, l.assigned_to,
                       ROUND(EXTRACT(EPOCH FROM (l.sla_deadline - NOW())) / 60)::int AS minutes_left
                FROM leads l
                WHERE l.assigned_to IS NOT NULL AND l.status = 'New'
                  AND l.red_flag_triggered = false AND l.sla_deadline IS NOT NULL
                  AND l.sla_deadline > NOW()
                  AND ($1::text IS NULL OR l.assigned_to::text = $1::text)
                  AND NOT EXISTS (
                    SELECT 1 FROM lead_notes n
                    WHERE n.lead_id = l.id AND n.commented_by = l.assigned_to
                      AND n.created_at > l.assigned_at)
                ORDER BY l.sla_deadline ASC LIMIT 100`, [sid]),
    pool.query(`SELECT f.id, f.created_at, f.lead_id, l.lead_name,
                       u.name AS agent_name, nu.name AS now_with
                FROM agent_red_flags f
                JOIN users u ON u.id = f.staff_id
                LEFT JOIN leads l ON l.id = f.lead_id
                LEFT JOIN users nu ON nu.id = l.assigned_to
                WHERE ${inRange('f.flag_date')} AND ${scope('f.staff_id')}
                ORDER BY f.created_at DESC LIMIT 10`, R3),
    pool.query(`SELECT COALESCE(d.name, 'Unclassified') AS department,
                       COUNT(*) FILTER (WHERE l.status = 'New')::int AS new_leads,
                       COUNT(*) FILTER (WHERE l.status = 'Warm')::int AS warm,
                       COUNT(*) FILTER (WHERE l.status = 'Prospect')::int AS prospect,
                       COUNT(*) FILTER (WHERE l.status = 'Closed')::int AS closed,
                       COUNT(*) FILTER (WHERE l.status = 'Dead')::int AS dead
                FROM leads l LEFT JOIN departments d ON d.id = l.department_id
                WHERE ${inRange('l.created_at')} AND ${scope('l.assigned_to')}
                GROUP BY 1 ORDER BY COUNT(*) DESC`, R3),
    pool.query(`SELECT COALESCE(l.source, 'Unknown') AS source, COUNT(*)::int AS count
                FROM leads l WHERE ${inRange('l.created_at')} AND ${scope('l.assigned_to')}
                GROUP BY 1 ORDER BY count DESC LIMIT 6`, R3),
    pool.query(`SELECT EXTRACT(HOUR FROM l.created_at)::int AS hour, COUNT(*)::int AS count
                FROM leads l WHERE ${inRange('l.created_at')} AND ${scope('l.assigned_to')}
                GROUP BY 1 ORDER BY 1`, R3),
  ]);

  // Meeting mode table is created lazily elsewhere, so never let it break this API.
  let inMeeting = [];
  try {
    const m = await pool.query(
      `SELECT staff_id FROM staff_meeting_mode WHERE in_meeting = true AND updated_at >= CURRENT_DATE`
    );
    inMeeting = m.rows.map((r) => r.staff_id);
  } catch (e) {
    inMeeting = [];
  }

  // Employee view: keep only their own row. If they are not in department_staff, build a basic row.
  let agentList = agents.rows;
  if (scoped) {
    agentList = agentList.filter((a) => String(a.id) === sid);
    if (agentList.length === 0) {
      const u = await pool.query(`SELECT id, name FROM users WHERE id::text = $1`, [sid]);
      if (u.rows[0]) agentList = [{ id: u.rows[0].id, name: u.rows[0].name, department: null, is_online: true }];
    }
  }

  const statsById = Object.fromEntries(agentStats.rows.map((r) => [r.id, r]));
  const flagsById = Object.fromEntries(agentFlags.rows.map((r) => [r.id, r.flags]));
  const openByAgent = {};
  openLeads.rows.forEach((r) => {
    (openByAgent[r.assigned_to] = openByAgent[r.assigned_to] || []).push(r);
  });

  const agentRows = agentList.map((a) => {
    const s = statsById[a.id] || {};
    const leads = s.leads || 0;
    const flags = flagsById[a.id] || 0;
    return {
      id: a.id,
      name: a.name,
      department: a.department,
      is_online: !!a.is_online,
      in_meeting: inMeeting.includes(a.id),
      leads,
      flags,
      avg_reply_min: s.avg_reply_min ?? null,
      sla_met_pct: leads ? Math.max(0, Math.round(((leads - flags) / leads) * 100)) : null,
      open_leads: openByAgent[a.id] || [],
    };
  });

  return {
    range: key,
    scope: scoped ? 'self' : 'all',
    summary: {
      ...summary.rows[0],
      pending_assignment: scoped ? 0 : pending.rows[0].count,
      red_flags: flagCount.rows[0].count,
      auto_shuffled: scoped ? 0 : shuffled.rows[0].count,
      agents_online: scoped ? 0 : staffCounts.rows[0].online,
      agents_total: scoped ? 0 : staffCounts.rows[0].total,
    },
    previous: prevSummary.rows[0],
    pending: scoped ? { count: 0, oldest_min: 0 } : pending.rows[0],
    agents: agentRows,
    open_leads: openLeads.rows,
    red_flag_feed: flagFeed.rows,
    by_department: byDept.rows,
    by_source: bySource.rows,
    by_hour: byHour.rows,
  };
};

module.exports = { getTeamMonitor };