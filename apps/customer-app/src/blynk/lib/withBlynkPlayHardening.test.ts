import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * plugins/withBlynkPlayHardening.js: the two release-hardening edits (drop expo-location's unused
 * foreground service from the manifest, ask Gradle for native debug symbols). The plugin is plain
 * CommonJS (Expo loads it that way), so it is loaded with require; only its pure helpers are tested.
 */
const PLUGIN = join(__dirname, '..', '..', '..', 'plugins', 'withBlynkPlayHardening.js');
const load = createRequire(__filename);

type Helpers = {
  removeServices: (doc: any, names?: string[]) => any;
  addDebugSymbols: (gradle: string) => string;
  UNUSED_SERVICES: string[];
};

function helpers(): Helpers {
  // the plugin requires 'expo/config-plugins', which is installed with the app
  return load(PLUGIN) as Helpers;
}

const TEMPLATE_GRADLE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

describe('removeServices', () => {
  it('adds a tools:node="remove" service entry and the tools namespace', () => {
    const { removeServices, UNUSED_SERVICES } = helpers();
    const doc: any = { manifest: { $: { 'xmlns:android': 'a' }, application: [{ $: {}, service: [] }] } };
    removeServices(doc);
    expect(doc.manifest.$['xmlns:tools']).toBe('http://schemas.android.com/tools');
    expect(UNUSED_SERVICES).toContain('expo.modules.location.services.LocationTaskService');
    expect(doc.manifest.application[0].service).toEqual([
      { $: { 'android:name': 'expo.modules.location.services.LocationTaskService', 'tools:node': 'remove' } },
    ]);
  });

  it('is idempotent and creates the service list when there is none', () => {
    const { removeServices } = helpers();
    const doc: any = { manifest: { application: [{ $: {} }] } };
    removeServices(doc);
    removeServices(doc);
    expect(doc.manifest.application[0].service).toHaveLength(1);
  });

  it('marks an already declared service for removal instead of duplicating it', () => {
    const { removeServices } = helpers();
    const name = 'expo.modules.location.services.LocationTaskService';
    const doc: any = { manifest: { $: { 'xmlns:tools': 'x' }, application: [{ service: [{ $: { 'android:name': name } }] }] } };
    removeServices(doc);
    expect(doc.manifest.application[0].service).toEqual([{ $: { 'android:name': name, 'tools:node': 'remove' } }]);
    expect(doc.manifest.$['xmlns:tools']).toBe('x');
  });

  it('never touches the services the app needs (FCM, notifications)', () => {
    const { removeServices } = helpers();
    const keep = { $: { 'android:name': 'expo.modules.notifications.service.ExpoFirebaseMessagingService' } };
    const doc: any = { manifest: { application: [{ service: [keep] }] } };
    removeServices(doc);
    expect(keep.$).toEqual({ 'android:name': 'expo.modules.notifications.service.ExpoFirebaseMessagingService' });
  });

  it('throws a clear message when there is no <application>', () => {
    const { removeServices } = helpers();
    expect(() => removeServices({ manifest: {} })).toThrow(/no <application>/);
  });

  it('removes only a service that expo-location really declares', () => {
    const { UNUSED_SERVICES } = helpers();
    const dir = join(__dirname, '..', '..', '..', 'node_modules', 'expo-location', 'android', 'src');
    // the library declares it relative (.services.LocationTaskService) in its own package
    const manifest = readFileSync(join(dir, 'main', 'AndroidManifest.xml'), 'utf8');
    expect(manifest).toContain('.services.LocationTaskService');
    expect(UNUSED_SERVICES[0].endsWith('.services.LocationTaskService')).toBe(true);
  });
});

describe('addDebugSymbols', () => {
  it('puts the ndk block at the top of the release build type only', () => {
    const { addDebugSymbols } = helpers();
    const out = addDebugSymbols(TEMPLATE_GRADLE);
    expect(out).toContain("ndk { debugSymbolLevel 'SYMBOL_TABLE' }");
    const release = out.slice(out.indexOf('        release {'));
    expect(release).toContain('debugSymbolLevel');
    const debug = out.slice(out.indexOf('        debug {\n            signingConfig'), out.indexOf('        release {'));
    expect(debug).not.toContain('debugSymbolLevel');
    expect(out.match(/debugSymbolLevel/g)).toHaveLength(1);
  });

  it('is idempotent', () => {
    const { addDebugSymbols } = helpers();
    const once = addDebugSymbols(TEMPLATE_GRADLE);
    expect(addDebugSymbols(once)).toBe(once);
  });

  it('leaves a gradle file it does not recognise unchanged', () => {
    const { addDebugSymbols } = helpers();
    expect(addDebugSymbols('android { }')).toBe('android { }');
  });

  it('keeps working after withBlynkRelease has added a release signing config', () => {
    const { addDebugSymbols } = helpers();
    const signed = TEMPLATE_GRADLE.replace(
      'signingConfigs {',
      'signingConfigs {\n        if (x) {\n            release {\n                storeFile file(y)\n            }\n        }',
    );
    const out = addDebugSymbols(signed);
    // inserted in the build type, not in the signing config
    expect(out.indexOf('debugSymbolLevel')).toBeGreaterThan(out.indexOf('buildTypes {'));
  });
});
