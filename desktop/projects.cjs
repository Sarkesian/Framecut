// Project storage: one folder per project with atomic saves, rolling backups (version history),
// recovery from damaged files, and migration of the legacy single-project workspace.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { normalizeProject, newProject, projectDuration, uid } = require('../shared/model.mjs');
const { writeAtomic } = require('./jsonstore.cjs');

const SAFE_ID = /^[a-z0-9-]{8,64}$/i;
class Projects {
  constructor({ dataDir, projectsDir }) { this.root = projectsDir || path.join(dataDir, 'projects'); this.dataDir = dataDir; this.lastBackup = new Map(); }
  async init() {
    await fsp.mkdir(path.join(this.root, '.trash'), { recursive: true });
    // Migrate the single project from FrameCut 1.x.
    const legacy = path.join(this.dataDir, 'project.json');
    if (fs.existsSync(legacy)) {
      try {
        const v1 = JSON.parse(await fsp.readFile(legacy, 'utf8'));
        if (v1 && (v1.clips?.length || v1.audioClips?.length || v1.captions?.length)) {
          const p = normalizeProject(v1); p.name = v1.name && v1.name !== 'Untitled story' ? v1.name : 'My first FrameCut project';
          await this.save(p, { backup: false });
        }
        await fsp.rename(legacy, path.join(this.dataDir, 'project.v1-backup.json'));
      } catch (e) { console.error('Legacy project migration failed:', e.message); }
    }
  }
  dir(id) { if (!SAFE_ID.test(id)) throw Error('Invalid project id.'); return path.join(this.root, id); }
  async list() {
    const out = [];
    for (const id of await fsp.readdir(this.root).catch(() => [])) {
      if (id.startsWith('.')) continue;
      try {
        const p = await this.load(id, { quiet: true });
        const thumb = path.join(this.dir(id), 'thumb.jpg');
        out.push({ id: p.id, name: p.name, modified: p.modified, created: p.created, ratio: p.settings.ratio, duration: projectDuration(p), clips: p.clips.length, thumb: fs.existsSync(thumb) ? `/api/projects/${id}/thumb?v=${Date.parse(p.modified) || 0}` : null, recovered: !!p.recovered });
      } catch {}
    }
    return out.sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
  }
  async load(id, { quiet } = {}) {
    const file = path.join(this.dir(id), 'project.json');
    try { const p = normalizeProject(JSON.parse(await fsp.readFile(file, 'utf8'))); p.id = id; return p; }
    catch (e) {
      // Recover from the newest readable backup.
      const backups = await this.backups(id).catch(() => []);
      for (const b of backups) {
        try { const p = normalizeProject(JSON.parse(await fsp.readFile(path.join(this.dir(id), 'backups', b.name), 'utf8'))); p.id = id; p.recovered = b.time; return p; } catch {}
      }
      if (!quiet) throw Error('This project could not be opened. The file may be damaged and no backup was found.');
      throw e;
    }
  }
  // Saves of one project run strictly in call order, so the newest state is always the one left on disk.
  save(project, opts) {
    const id = project?.id; this.dir(id); // validates the id before queueing
    this.queues ||= new Map();
    const run = (this.queues.get(id) || Promise.resolve()).catch(() => {}).then(() => this._save(project, opts));
    this.queues.set(id, run); run.finally(() => { if (this.queues.get(id) === run) this.queues.delete(id); }).catch(() => {});
    return run;
  }
  async _save(project, { backup = true } = {}) {
    const p = normalizeProject(project); delete p.recovered;
    p.modified = new Date().toISOString();
    const dir = this.dir(p.id); await fsp.mkdir(path.join(dir, 'backups'), { recursive: true });
    const file = path.join(dir, 'project.json'), json = JSON.stringify(p);
    await writeAtomic(file, json); // unique temp file + replace
    // Keep a version snapshot at most every 3 minutes; retain 30.
    const last = this.lastBackup.get(p.id) || 0;
    if (backup && Date.now() - last > 180e3) {
      this.lastBackup.set(p.id, Date.now());
      await fsp.writeFile(path.join(dir, 'backups', `${Date.now()}.json`), json);
      const list = await this.backups(p.id); for (const b of list.slice(30)) await fsp.unlink(path.join(dir, 'backups', b.name)).catch(() => {});
    }
    return p;
  }
  async create(opts = {}) { const p = opts.project ? normalizeProject({ ...opts.project, id: uid() }) : newProject(opts); p.id = uid(); return this.save(p, { backup: false }); }
  async duplicate(id) { const p = await this.load(id); p.id = uid(); p.name = p.name + ' copy'; p.created = new Date().toISOString(); const out = await this.save(p, { backup: false }); const thumb = path.join(this.dir(id), 'thumb.jpg'); if (fs.existsSync(thumb)) await fsp.copyFile(thumb, path.join(this.dir(out.id), 'thumb.jpg')); return out; }
  async remove(id) { const dir = this.dir(id); await fsp.rename(dir, path.join(this.root, '.trash', id + '-' + Date.now())).catch(async () => fsp.rm(dir, { recursive: true, force: true })); }
  async backups(id) {
    const dir = path.join(this.dir(id), 'backups');
    return (await fsp.readdir(dir).catch(() => [])).filter(n => /^\d+\.json$/.test(n)).map(n => ({ name: n, time: new Date(+n.slice(0, -5)).toISOString() })).sort((a, b) => b.name.localeCompare(a.name));
  }
  async backup(id, name) { if (!/^\d+\.json$/.test(name)) throw Error('Invalid backup.'); return normalizeProject(JSON.parse(await fsp.readFile(path.join(this.dir(id), 'backups', name), 'utf8'))); }
  async setThumb(id, dataUrl) { const m = /^data:image\/jpeg;base64,(.+)$/.exec(String(dataUrl || '')); if (!m) throw Error('Invalid thumbnail.'); await fsp.writeFile(path.join(this.dir(id), 'thumb.jpg'), Buffer.from(m[1], 'base64')); }
  thumbPath(id) { return path.join(this.dir(id), 'thumb.jpg'); }
}
module.exports = { Projects };
