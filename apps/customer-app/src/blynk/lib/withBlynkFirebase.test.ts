import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * plugins/withBlynkFirebase.js: switches Crashlytics' build-time mapping-file upload off (it needs
 * the network and a Firebase login, and must never break an offline local release build). Plain
 * CommonJS like the other plugins; only the pure helper is tested.
 */
const PLUGIN = join(__dirname, '..', '..', '..', 'plugins', 'withBlynkFirebase.js');
const load = createRequire(__filename);
type Helpers = { disableMappingUpload: (gradle: string) => string; MARK: string };
const helpers = () => load(PLUGIN) as Helpers;

const GRADLE = `apply plugin: "com.android.application"
android {
    buildTypes {
        release { minifyEnabled true }
    }
}
apply plugin: 'com.google.gms.google-services'
apply plugin: 'com.google.firebase.crashlytics'
`;

describe('withBlynkFirebase: Crashlytics mapping upload', () => {
  it('appends a switch that is off unless asked for, once', () => {
    const { disableMappingUpload, MARK } = helpers();
    const out = disableMappingUpload(GRADLE);
    expect(out.startsWith(GRADLE.trimEnd())).toBe(true);
    expect(out).toContain(MARK);
    expect(out).toContain("pluginManager.withPlugin('com.google.firebase.crashlytics')");
    expect(out).toContain('mappingFileUploadEnabled blynkUploadMapping');
    // off by default, on only with -PblynkCrashlyticsMapping=true or BLYNK_CRASHLYTICS_MAPPING=true
    expect(out).toContain("?: 'false'}\" == 'true'");
    expect(out).toContain("findProperty('blynkCrashlyticsMapping')");
    expect(out).toContain("System.getenv('BLYNK_CRASHLYTICS_MAPPING')");
    expect(disableMappingUpload(out)).toBe(out);
  });

  it('works whatever order the apply lines come in (the block does not depend on them)', () => {
    const { disableMappingUpload } = helpers();
    const out = disableMappingUpload(`android { }\n`);
    expect(out).toContain('buildType.firebaseCrashlytics');
  });
});
