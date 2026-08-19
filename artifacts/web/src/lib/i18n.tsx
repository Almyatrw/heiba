import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

// Arabic-first / English-ready UI. The default locale is Arabic (RTL);
// English is available from the language toggle. User-generated content
// (titles, descriptions, notes) is rendered as stored.
export type Locale = "ar" | "en";

const DICTIONARY = {
  "brand.tagline": { ar: "عرض خاص", en: "Private screening" },
  "brand.room": { ar: "صالة العرض الخاصة", en: "Private screening room" },

  "nav.watch": { ar: "المشاهدة", en: "Watch" },
  "nav.manage": { ar: "الإدارة", en: "Manage" },
  "nav.library": { ar: "المكتبة", en: "Library" },
  "nav.reviewQueue": { ar: "قائمة المراجعة", en: "Review queue" },
  "nav.videos": { ar: "الفيديوهات", en: "Videos" },
  "nav.groups": { ar: "المجموعات", en: "Groups" },
  "nav.members": { ar: "الأعضاء", en: "Members" },
  "nav.categories": { ar: "التصنيفات", en: "Categories" },

  "auth.signOut": { ar: "تسجيل الخروج", en: "Sign out" },
  "role.OWNER": { ar: "المالك", en: "Owner" },
  "role.ADMIN": { ar: "مشرف", en: "Admin" },
  "role.GROUP_MANAGER": { ar: "مدير مجموعة", en: "Group manager" },
  "role.MEMBER": { ar: "عضو", en: "Member" },

  "login.email": { ar: "البريد الإلكتروني", en: "Email" },
  "login.password": { ar: "كلمة المرور", en: "Password" },
  "login.enter": { ar: "دخول", en: "Enter" },
  "login.entering": { ar: "جارٍ فتح الباب…", en: "Opening the door…" },
  "login.inviteOnly": {
    ar: "الدخول بدعوة فقط. اطلب حسابًا من المشرف.",
    en: "Access is by invitation only. Ask your administrator for an account.",
  },
  "login.failed": { ar: "فشل تسجيل الدخول", en: "Sign-in failed" },

  "common.save": { ar: "حفظ", en: "Save" },
  "common.cancel": { ar: "إلغاء", en: "Cancel" },
  "common.add": { ar: "إضافة", en: "Add" },
  "common.close": { ar: "إغلاق", en: "Close" },
  "common.noneYet": { ar: "لا يوجد بعد", en: "None yet" },
  "common.saveFailed": { ar: "فشل الحفظ", en: "Save failed" },
  "common.optional": { ar: "اختياري", en: "optional" },
  "common.language": { ar: "English", en: "العربية" },

  "library.kicker": { ar: "المكتبة", en: "Library" },
  "library.kickerAdmin": {
    ar: "المكتبة · كل العناوين المعتمدة",
    en: "Library · all approved titles",
  },
  "library.title": { ar: "رف العرض", en: "Screening shelf" },
  "library.search": {
    ar: "ابحث في العناوين والأوصاف…",
    en: "Search titles and descriptions…",
  },
  "library.allCategories": { ar: "كل التصنيفات", en: "All categories" },
  "library.allGroups": { ar: "كل المجموعات", en: "All groups" },
  "library.titles": { ar: "{count} عنوان", en: "{count} titles" },
  "library.emptyTitle": { ar: "الرف فارغ بعد", en: "Nothing on the shelf yet" },
  "library.emptyBody": {
    ar: "عندما يعتمد المشرف فيديو لإحدى مجموعاتك سيظهر هنا.",
    en: "When an administrator approves a video for one of your groups, it appears here.",
  },
  "library.loading": { ar: "جارٍ تحضير الأرشيف…", en: "Rolling the archive…" },

  "watch.back": { ar: "عودة إلى المكتبة", en: "Back to library" },
  "watch.duration": { ar: "المدة", en: "Duration" },
  "watch.size": { ar: "الحجم", en: "Size" },
  "watch.added": { ar: "أضيف", en: "Added" },
  "watch.notFoundTitle": { ar: "الفيلم غير موجود", en: "Reel not found" },
  "watch.notFoundBody": {
    ar: "هذا العنوان غير متاح أو غير مشارك معك.",
    en: "This title is unavailable or not shared with you.",
  },
  "watch.loading": { ar: "جارٍ تعتيم الأضواء…", en: "Dimming the lights…" },

  "status.APPROVED": { ar: "معتمد", en: "Approved" },
  "status.PENDING_REVIEW": { ar: "بانتظار المراجعة", en: "Pending review" },
  "status.REJECTED": { ar: "مرفوض", en: "Rejected" },
  "status.PRIVATE": { ar: "خاص", en: "Private" },
  "status.PROCESSING": { ar: "قيد المعالجة", en: "Processing" },
  "status.ARCHIVED": { ar: "مؤرشف", en: "Archived" },
  "status.FAILED": { ar: "فشل", en: "Failed" },

  "videos.kicker": { ar: "الإدارة", en: "Manage" },
  "videos.title": { ar: "الفيديوهات", en: "Videos" },
  "videos.new": { ar: "فيديو جديد", en: "New video" },
  "videos.allStatuses": { ar: "كل الحالات", en: "All statuses" },
  "videos.emptyTitle": { ar: "لا توجد فيديوهات بعد", en: "No videos yet" },
  "videos.emptyBody": {
    ar: "أنشئ سجل فيديو، ارفع ملفه، ثم اعتمده من قائمة المراجعة.",
    en: "Create a video entry, upload its file, then approve it from the review queue.",
  },
  "videos.createFirst": { ar: "أنشئ أول فيديو", en: "Create the first video" },
  "videos.colTitle": { ar: "العنوان", en: "Title" },
  "videos.colStatus": { ar: "الحالة", en: "Status" },
  "videos.colFile": { ar: "الملف", en: "File" },
  "videos.colAccess": { ar: "الوصول", en: "Access" },
  "videos.colCreated": { ar: "أُنشئ", en: "Created" },
  "videos.colActions": { ar: "إجراءات", en: "Actions" },
  "videos.noFile": { ar: "لا ملف", en: "no file" },
  "videos.private": { ar: "خاص", en: "private" },
  "videos.groups": { ar: "{count} مجموعات", en: "{count} groups" },
  "videos.group": { ar: "{count} مجموعة", en: "{count} group" },
  "videos.edit": { ar: "تعديل {title}", en: "Edit {title}" },
  "videos.watch": { ar: "مشاهدة", en: "Watch" },
  "videos.uploadFile": { ar: "رفع ملف", en: "Upload file" },
  "videos.replaceFile": { ar: "استبدال الملف", en: "Replace file" },
  "videos.deleteConfirm": {
    ar: "حذف «{title}»؟ سيُحذف الملف المخزّن نهائيًا.",
    en: "Delete “{title}”? The stored file is removed permanently.",
  },
  "videos.fieldTitle": { ar: "العنوان", en: "Title" },
  "videos.fieldDescription": { ar: "الوصف", en: "Description" },
  "videos.fieldTags": { ar: "الوسوم", en: "Tags" },
  "videos.tagsHint": { ar: "مفصولة بفواصل", en: "Comma-separated" },
  "videos.tagsPlaceholder": {
    ar: "تعريفي، تدريب",
    en: "onboarding, training",
  },
  "videos.fieldCategories": { ar: "التصنيفات", en: "Categories" },
  "videos.fieldGroups": { ar: "مجموعات الوصول", en: "Access groups" },

  "upload.modalTitle": {
    ar: "{action} الملف — {title}",
    en: "{action} file — {title}",
  },
  "upload.upload": { ar: "رفع", en: "Upload" },
  "upload.replace": { ar: "استبدال", en: "Replace" },
  "upload.tabFile": { ar: "رفع ملف", en: "Upload file" },
  "upload.tabUrl": { ar: "استيراد من رابط", en: "Import from URL" },
  "upload.hint": {
    ar: "mp4 أو webm أو mov أو mkv. {suffix}",
    en: "mp4, webm, mov or mkv. {suffix}",
  },
  "upload.hintReplace": {
    ar: "استبدال الملف يعيد الفيديو إلى المراجعة اليدوية.",
    en: "Replacing the file sends the video back through manual review.",
  },
  "upload.hintNew": {
    ar: "بعد الرفع ينتظر الفيديو في قائمة المراجعة.",
    en: "After upload, the video waits in the review queue.",
  },
  "upload.uploading": { ar: "جارٍ الرفع…", en: "Uploading…" },
  "upload.failed": { ar: "فشل الرفع", en: "Upload failed" },
  "upload.abort": { ar: "إيقاف", en: "Abort" },
  "upload.importUrlLabel": { ar: "رابط الفيديو المباشر", en: "Direct video URL" },
  "upload.importUrlPlaceholder": {
    ar: "https://example.com/video.mp4",
    en: "https://example.com/video.mp4",
  },
  "upload.importHint": {
    ar: "روابط ملفات الفيديو المباشرة فقط (mp4/webm/mkv/mov). يوتيوب ومنصات التواصل غير مدعومة في هذا الإصدار.",
    en: "Direct video file URLs only (mp4/webm/mkv/mov). YouTube and social platforms are not supported in V1.",
  },
  "upload.import": { ar: "استيراد", en: "Import" },
  "upload.importing": { ar: "جارٍ الاستيراد…", en: "Importing…" },
  "upload.importFailed": { ar: "فشل الاستيراد", en: "Import failed" },

  "reviews.kicker": { ar: "مراجعة يدوية", en: "Manual review" },
  "reviews.title": { ar: "قائمة المراجعة", en: "Review queue" },
  "reviews.emptyTitle": { ar: "القائمة فارغة", en: "The queue is clear" },
  "reviews.emptyBody": {
    ar: "تظهر الفيديوهات المرفوعة هنا للاعتماد قبل أن يراها الأعضاء.",
    en: "Uploaded videos appear here for approval before members can see them.",
  },
  "reviews.previousDecisions": { ar: "قرارات سابقة", en: "Previous decisions" },
  "reviews.notesLabel": {
    ar: "ملاحظات (مطلوبة عند الرفض)",
    en: "Notes (required to reject)",
  },
  "reviews.notesPlaceholder": {
    ar: "لماذا يُعتمد أو يُرفض هذا الفيديو؟",
    en: "Why is this being approved or rejected?",
  },
  "reviews.noteRequired": {
    ar: "الملاحظة مطلوبة عند الرفض.",
    en: "A note is required when rejecting.",
  },
  "reviews.approve": { ar: "اعتماد", en: "Approve" },
  "reviews.approving": { ar: "جارٍ الاعتماد…", en: "Approving…" },
  "reviews.reject": { ar: "رفض", en: "Reject" },
  "reviews.rejecting": { ar: "جارٍ الرفض…", en: "Rejecting…" },
  "reviews.failed": { ar: "فشلت المراجعة", en: "Review failed" },
  "reviews.unknownType": { ar: "نوع غير معروف", en: "unknown type" },
  "reviews.uploaded": { ar: "رُفع {date}", en: "uploaded {date}" },
  "reviews.noGroups": {
    ar: "بدون مجموعات — يبقى خاصًا",
    en: "No groups — stays private",
  },

  "groups.title": { ar: "المجموعات", en: "Groups" },
  "groups.new": { ar: "مجموعة جديدة", en: "New group" },
  "groups.emptyTitle": { ar: "لا توجد مجموعات بعد", en: "No groups yet" },
  "groups.emptyBody": {
    ar: "المجموعات تحدد من يمكنه مشاهدة ماذا. الفيديوهات خاصة افتراضيًا.",
    en: "Groups control who can watch what. Videos are private by default.",
  },
  "groups.createFirst": { ar: "أنشئ أول مجموعة", en: "Create the first group" },
  "groups.deleteConfirm": {
    ar: "حذف هذه المجموعة؟ تحتفظ الفيديوهات بمجموعات الوصول الأخرى.",
    en: "Delete this group? Videos keep their other access groups.",
  },
  "groups.fieldName": { ar: "الاسم", en: "Name" },
  "groups.fieldDescription": { ar: "الوصف", en: "Description" },
  "groups.edit": { ar: "تعديل {name}", en: "Edit {name}" },
  "groups.manageMembers": { ar: "إدارة الأعضاء", en: "Manage members" },
  "groups.membersTitle": { ar: "الأعضاء — {name}", en: "Members — {name}" },
  "groups.addMember": { ar: "أضف عضوًا…", en: "Add a member…" },
  "groups.addMemberFailed": { ar: "تعذّرت إضافة العضو", en: "Could not add member" },
  "groups.noMembers": { ar: "لا أعضاء بعد.", en: "No members yet." },
  "groups.memberCount": { ar: "{count} عضو", en: "{count} members" },
  "groups.memberRole": { ar: "عضو", en: "member" },
  "groups.managerRole": { ar: "مدير", en: "manager" },
  "groups.joined": { ar: "انضم {date}", en: "joined {date}" },

  "users.title": { ar: "الأعضاء", en: "Members" },
  "users.invite": { ar: "دعوة عضو", en: "Invite member" },
  "users.emptyTitle": { ar: "لا أعضاء", en: "No members" },
  "users.colEmail": { ar: "البريد الإلكتروني", en: "Email" },
  "users.colRole": { ar: "الدور", en: "Role" },
  "users.colStatus": { ar: "الحالة", en: "Status" },
  "users.colJoined": { ar: "انضم", en: "Joined" },
  "users.colActions": { ar: "إجراءات", en: "Actions" },
  "users.active": { ar: "نشط", en: "Active" },
  "users.deactivated": { ar: "معطّل", en: "Deactivated" },
  "users.deactivate": { ar: "تعطيل", en: "Deactivate" },
  "users.reactivate": { ar: "إعادة تفعيل", en: "Reactivate" },
  "users.deactivateConfirm": {
    ar: "تعطيل {email}؟ ستُلغى جلساته فورًا.",
    en: "Deactivate {email}? Their sessions are revoked immediately.",
  },
  "users.edit": { ar: "تعديل {email}", en: "Edit {email}" },
  "users.passwordHint": {
    ar: "شاركها مع العضو بشكل خاص؛ يمكن مطالبته بتغييرها لاحقًا.",
    en: "Share this with the member privately; they can be asked to rotate it later.",
  },

  "categories.title": { ar: "التصنيفات", en: "Categories" },
  "categories.new": { ar: "تصنيف جديد", en: "New category" },
  "categories.emptyTitle": { ar: "لا توجد تصنيفات بعد", en: "No categories yet" },
  "categories.emptyBody": {
    ar: "التصنيفات تنظّم رف المكتبة للأعضاء.",
    en: "Categories organise the library shelf for members.",
  },
  "categories.createFirst": { ar: "أنشئ أول تصنيف", en: "Create the first one" },
  "categories.deleteConfirm": {
    ar: "حذف هذا التصنيف؟ تحتفظ الفيديوهات بتصنيفاتها الأخرى.",
    en: "Delete this category? Videos keep their other categories.",
  },
  "categories.edit": { ar: "تعديل {name}", en: "Edit {name}" },

  "app.opening": {
    ar: "جارٍ فتح صالة العرض…",
    en: "Opening the screening room…",
  },
} as const;

export type I18nKey = keyof typeof DICTIONARY;

interface I18nContextValue {
  locale: Locale;
  dir: "rtl" | "ltr";
  setLocale: (locale: Locale) => void;
  t: (key: I18nKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = "heiba.locale";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "en" || stored === "ar" ? stored : "ar";
  });

  const dir = locale === "ar" ? "rtl" : "ltr";

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
    localStorage.setItem(STORAGE_KEY, locale);
  }, [locale, dir]);

  const setLocale = (next: Locale) => setLocaleState(next);

  const t = (key: I18nKey, vars?: Record<string, string | number>) => {
    let text: string = DICTIONARY[key][locale];
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
    }
    return text;
  };

  return (
    <I18nContext.Provider value={{ locale, dir, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

export function useT() {
  return useI18n().t;
}
