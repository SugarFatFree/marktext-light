import type { App } from 'vue'
import {
  ElAutocomplete,
  ElInput,
  ElOption,
  ElRadio,
  ElRadioGroup,
  ElSelect,
  ElSlider,
  ElSwitch,
  ElTable,
  ElTableColumn
} from 'element-plus'

// Styles for these, loaded with them. They travel in the settings chunk rather
// than the entry for the same reason the components do: the editor window
// never renders this markup, and the table and the select are the heaviest
// things in the library.
import 'element-plus/es/components/autocomplete/style/css'
import 'element-plus/es/components/input/style/css'
import 'element-plus/es/components/option/style/css'
import 'element-plus/es/components/radio/style/css'
import 'element-plus/es/components/radio-group/style/css'
import 'element-plus/es/components/select/style/css'
import 'element-plus/es/components/slider/style/css'
import 'element-plus/es/components/switch/style/css'
import 'element-plus/es/components/table/style/css'
import 'element-plus/es/components/table-column/style/css'

/**
 * Element Plus components used only by the settings window.
 *
 * They are registered when the settings tree loads rather than at startup.
 * Eagerly registering them cost the editor window 141 KB of first paint — the
 * table and the select are the heaviest things in the library — for markup it
 * never renders.
 *
 * A component added here that the editor also uses would fail to resolve there,
 * silently: Vue warns and renders nothing. `element-plus-registration.spec.ts`
 * checks the split against the actual `<el-…>` tags in both trees.
 */
const SETTINGS_ONLY = [
  ElAutocomplete,
  ElInput,
  ElOption,
  ElRadio,
  ElRadioGroup,
  ElSelect,
  ElSlider,
  ElSwitch,
  ElTable,
  ElTableColumn
]

export const registerSettingsComponents = (app: App): void => {
  for (const component of SETTINGS_ONLY) {
    app.component(component.name!, component)
  }
}
