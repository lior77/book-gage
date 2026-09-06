# מפתח חתימה קבוע — כדי שעדכון לא ימחק את הנקודות שלך

## הבעיה

אנדרואיד מתקין גרסה חדשה **על גבי** הישנה רק אם שתיהן חתומות באותו מפתח.
בלי מפתח קבוע, Gradle ממציא מפתח debug אקראי חדש בכל בנייה על שרת נקי, וכל
עדכון יידחה עם `App not installed`. הדרך היחידה קדימה היא להסיר ולהתקין —
וההסרה מוחקת את הנקודות ששמרת.

אימות: הריצה מדפיסה `keystore present: no` ואת טביעת האצבע של המפתח בכל בנייה.

## הפתרון — פעם אחת, חמש דקות

**המפתח הפרטי לא עובר דרך שום צ׳אט ולא נכנס למאגר.** יוצרים אותו במחשב שלך,
והוא נשמר כסוד מוצפן בגיטהאב.

### 1. יוצרים מפתח (במחשב עם Java מותקנת)

```bash
keytool -genkeypair -v \
  -keystore porto.jks -alias porto \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass CHOOSE_A_PASSWORD -keypass CHOOSE_A_PASSWORD \
  -dname "CN=Porto Atlas, OU=personal, O=personal, L=, S=, C=PT"
```

### 2. הופכים אותו לטקסט

```bash
base64 -w0 porto.jks > porto.jks.b64        # לינוקס
base64 -i porto.jks -o porto.jks.b64        # macOS
```

### 3. מוסיפים כסודות במאגר

`Settings` ← `Secrets and variables` ← `Actions` ← `New repository secret`:

| שם | ערך |
|---|---|
| `ANDROID_KEYSTORE_B64` | כל התוכן של `porto.jks.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | הסיסמה שבחרת |
| `ANDROID_KEY_ALIAS` | `porto` |
| `ANDROID_KEY_PASSWORD` | אותה סיסמה |

### 4. מריצים את ה-workflow מחדש

`Actions` ← `Porto atlas — Android APK` ← `Run workflow`.

הריצה תדפיס `signing with the stored key`, ומהגרסה הזאת והלאה כל עדכון יותקן
על גבי הקודמת וישמור את הנקודות.

**שומרים את `porto.jks` במקום בטוח.** אם הוא יאבד, המפתח יתחלף שוב והמעגל יחזור.

## עד שזה נעשה

התקנה של גרסה חדשה תדרוש הסרה. לכן יש באפליקציה **העתקת הנקודות** ו**ייבוא
נקודות** — מייצאים לפני ההסרה ומייבאים אחריה, וזה עובד גם למעבר בין מכשירים.
