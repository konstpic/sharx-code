package service

import (
	"encoding/json"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/util/common"
)

// designerLibraryKey holds the subscription-page designer's saved elements and templates as one JSON document.
// It is kept out of the general settings response (see GetAllSetting) because it can be large.
const designerLibraryKey = "designerLibrary"

// designerLibraryMaxBytes bounds the stored document.
const designerLibraryMaxBytes = 8 << 20

// GetDesignerLibrary returns the stored library JSON, or an empty string when nothing was saved yet.
func (s *SettingService) GetDesignerLibrary() (string, error) {
	setting, err := s.getSetting(designerLibraryKey)
	if database.IsNotFound(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return setting.Value, nil
}

// SetDesignerLibrary validates and stores the library JSON document.
func (s *SettingService) SetDesignerLibrary(value string) error {
	if len(value) > designerLibraryMaxBytes {
		return common.NewErrorf("designer library is too large (limit %d bytes)", designerLibraryMaxBytes)
	}
	if value != "" {
		var probe struct {
			Version int               `json:"version"`
			Items   []json.RawMessage `json:"items"`
		}
		if err := json.Unmarshal([]byte(value), &probe); err != nil {
			return common.NewErrorf("designer library is not valid JSON: %v", err)
		}
		if probe.Version != 1 {
			return common.NewErrorf("unsupported designer library version %d", probe.Version)
		}
	}
	return s.saveSetting(designerLibraryKey, value)
}
