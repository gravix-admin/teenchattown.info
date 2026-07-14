const pool = require("../database");

function calculateAge(dob) {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

function publicUser(user, viewer = null) {
  if (!user) return null;
  const self = viewer && Number(viewer.id) === Number(user.id);
  const staffViewer = viewer && ["moderator", "admin", "visor", "superadmin", "supervisor", "super visor", "inspector", "manager", "chief", "developer"].includes(viewer.rank_name);
  const sharesOnlineStatus = Number(user.show_online_status ?? 1) === 1;
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    email: self ? user.email : undefined,
    dob: self ? user.dob : undefined,
    age: self || Number(user.show_age ?? 1) === 1 ? user.age : undefined,
    gender: self || Number(user.show_gender ?? 1) === 1 ? user.gender : undefined,
    rank: user.rank_name,
    avatarUrl: user.avatar_url,
    bannerUrl: user.banner_url,
    animatedBannerUrl: user.animated_banner_url,
    profileMusicUrl: user.profile_music_url,
    profileTitle: user.profile_title,
    profileStatus: self || sharesOnlineStatus ? user.profile_status : undefined,
    profileAccent: user.profile_accent,
    showOnlineStatus: Boolean(user.show_online_status),
    showCountry: Boolean(Number(user.show_country ?? 1)),
    showAge: Boolean(Number(user.show_age ?? 1)),
    showGender: Boolean(Number(user.show_gender ?? 1)),
    bio: user.bio,
    aboutMe: user.about_me,
    mood: user.mood,
    theme: user.theme,
    chatBackground: user.chat_background,
    bubbleStyle: user.bubble_style,
    usernameColor: user.username_color,
    textColor: user.text_color,
    frame: user.frame,
    xp: user.xp,
    gold: user.gold,
    diamonds: user.diamonds,
    messageCount: user.message_count,
    profileLikes: user.profile_likes,
    visitorCount: user.visitor_count,
    svipUntil: user.svip_until,
    rankUntil: user.rank_until,
    rankPlan: user.rank_plan,
    country: self || Number(user.show_country ?? 1) === 1 ? user.country : undefined,
    mutedUntil: self || staffViewer ? user.muted_until : undefined,
    kickedUntil: self || staffViewer ? user.kicked_until : undefined,
    bannedUntil: self || staffViewer ? user.banned_until : undefined,
    deleteRequestedAt: user.delete_requested_at,
    lastSeen: self || sharesOnlineStatus ? user.last_seen : undefined,
    online: user.show_online_status === 0 || user.profile_status === "Invisible" ? false : Boolean(Number(user.is_online || 0) && user.last_seen && Date.now() - new Date(user.last_seen).getTime() < 70 * 1000),
    createdAt: user.created_at,
  };
}

async function userById(id) {
  const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [id]);
  return rows[0] || null;
}

async function rankBadges() {
  const [rows] = await pool.query("SELECT * FROM rank_badges");
  return Object.fromEntries(rows.map((row) => [row.rank_name, {
    label: row.label,
    color: row.color,
    imageUrl: row.image_url,
  }]));
}

async function adminStats() {
  const [[users]] = await pool.query("SELECT COUNT(*) AS total FROM users WHERE rank_name <> 'bot' AND LOWER(username) NOT IN ('intruder', 'zombie')");
  const [[staff]] = await pool.query("SELECT COUNT(*) AS total FROM users WHERE rank_name IN ('moderator','admin','visor','superadmin','supervisor','super visor','inspector','manager','chief','developer')");
  const [[rooms]] = await pool.query("SELECT COUNT(*) AS total FROM rooms");
  const [[reports]] = await pool.query("SELECT COUNT(*) AS total FROM reports WHERE status = 'open'");
  return { totalUsers: users.total, staffCount: staff.total, rooms: rooms.total, openReports: reports.total };
}

module.exports = { calculateAge, publicUser, userById, rankBadges, adminStats };
