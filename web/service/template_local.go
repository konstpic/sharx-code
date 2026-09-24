package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
)

const (
	localTemplateMaxCount = 2000
	localTemplateMaxBytes = 256 << 10
)

var (
	ErrLocalTemplateNotFound = errors.New("template not found")
	ErrLocalTemplateQuota    = errors.New("too many local templates")
	localTagRe               = regexp.MustCompile(`^[a-z0-9][a-z0-9 _-]{0,23}$`)
	localKinds               = map[string]bool{"inbound": true, "xray_config": true}
)

// LocalTemplateService manages templates stored in this panel's database.
type LocalTemplateService struct{}

// LocalTemplateInput is a validated create/update payload.
type LocalTemplateInput struct {
	Kind          string
	Title         string
	Description   string
	Tags          []string
	Content       json.RawMessage
	SourceCloudID string
}

// LocalTemplateView is the list representation (no content).
type LocalTemplateView struct {
	ID            int      `json:"id"`
	Kind          string   `json:"kind"`
	Title         string   `json:"title"`
	Description   string   `json:"description"`
	Tags          []string `json:"tags"`
	SizeBytes     int      `json:"sizeBytes"`
	SourceCloudID string   `json:"sourceCloudId"`
	CreatedAt     int64    `json:"createdAt"`
	UpdatedAt     int64    `json:"updatedAt"`
	// Summary is a small digest of the content (protocol/transport/security or config counts) for card previews.
	Summary map[string]any `json:"summary"`
}

// NormalizeLocalTags lowercases, dedupes and validates tags (at most 8).
func NormalizeLocalTags(in []string) ([]string, error) {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, t := range in {
		t = strings.ToLower(strings.TrimSpace(t))
		if t == "" || seen[t] {
			continue
		}
		if !localTagRe.MatchString(t) {
			return nil, fmt.Errorf("invalid tag %q", t)
		}
		seen[t] = true
		out = append(out, t)
	}
	if len(out) > 8 {
		return nil, errors.New("at most 8 tags")
	}
	return out, nil
}

// ValidateLocalTemplate checks metadata and returns the compact content and normalized tags.
func ValidateLocalTemplate(in *LocalTemplateInput) ([]byte, []string, error) {
	if !localKinds[in.Kind] {
		return nil, nil, errors.New("kind must be inbound or xray_config")
	}
	in.Title = strings.TrimSpace(in.Title)
	if n := utf8.RuneCountInString(in.Title); n < 1 || n > 120 {
		return nil, nil, errors.New("title must be 1-120 characters")
	}
	in.Description = strings.TrimSpace(in.Description)
	if utf8.RuneCountInString(in.Description) > 1000 {
		return nil, nil, errors.New("description is longer than 1000 characters")
	}
	tags, err := NormalizeLocalTags(in.Tags)
	if err != nil {
		return nil, nil, err
	}
	if len(in.SourceCloudID) > 64 {
		return nil, nil, errors.New("invalid source id")
	}
	if len(bytes.TrimSpace(in.Content)) == 0 {
		return nil, nil, errors.New("content is required")
	}
	var obj map[string]any
	if err := json.Unmarshal(in.Content, &obj); err != nil || obj == nil {
		return nil, nil, errors.New("content must be a JSON object")
	}
	var buf bytes.Buffer
	if err := json.Compact(&buf, in.Content); err != nil {
		return nil, nil, errors.New("content is not valid JSON")
	}
	if buf.Len() > localTemplateMaxBytes {
		return nil, nil, fmt.Errorf("content is larger than %d KiB", localTemplateMaxBytes>>10)
	}
	return buf.Bytes(), tags, nil
}

func toLocalView(t *model.LocalTemplate) LocalTemplateView {
	var tags []string
	_ = json.Unmarshal([]byte(t.Tags), &tags)
	if tags == nil {
		tags = []string{}
	}
	return LocalTemplateView{ID: t.Id, Kind: t.Kind, Title: t.Title, Description: t.Description, Tags: tags, SizeBytes: t.SizeBytes,
		SourceCloudID: t.SourceCloudID, CreatedAt: t.CreatedAt, UpdatedAt: t.UpdatedAt, Summary: SummarizeTemplate(t.Kind, []byte(t.Content))}
}

func escapeLikeLocal(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

// List returns one page of templates (newest first) and the total that matches.
func (s *LocalTemplateService) List(kind, q string, limit, offset int) ([]LocalTemplateView, int64, error) {
	db := database.GetDB().Model(&model.LocalTemplate{})
	if kind != "" {
		db = db.Where("kind = ?", kind)
	}
	if q = strings.TrimSpace(q); q != "" {
		like := "%" + escapeLikeLocal(q) + "%"
		db = db.Where("title ILIKE ? OR description ILIKE ? OR tags ILIKE ?", like, like, like)
	}
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	var rows []model.LocalTemplate
	if err := db.Order("id DESC").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	out := make([]LocalTemplateView, 0, len(rows))
	for i := range rows {
		out = append(out, toLocalView(&rows[i]))
	}
	return out, total, nil
}

func (s *LocalTemplateService) Create(in *LocalTemplateInput) (*LocalTemplateView, error) {
	content, tags, err := ValidateLocalTemplate(in)
	if err != nil {
		return nil, err
	}
	db := database.GetDB()
	var n int64
	if err := db.Model(&model.LocalTemplate{}).Count(&n).Error; err != nil {
		return nil, err
	}
	if n >= localTemplateMaxCount {
		return nil, ErrLocalTemplateQuota
	}
	tagsJSON, _ := json.Marshal(tags)
	now := time.Now().Unix()
	row := &model.LocalTemplate{Kind: in.Kind, Title: in.Title, Description: in.Description, Tags: string(tagsJSON),
		Content: string(content), SizeBytes: len(content), SourceCloudID: in.SourceCloudID, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(row).Error; err != nil {
		return nil, err
	}
	v := toLocalView(row)
	return &v, nil
}

// Get returns metadata and the stored content.
func (s *LocalTemplateService) Get(id int) (*LocalTemplateView, json.RawMessage, error) {
	var row model.LocalTemplate
	if err := database.GetDB().First(&row, id).Error; err != nil {
		if database.IsNotFound(err) {
			return nil, nil, ErrLocalTemplateNotFound
		}
		return nil, nil, err
	}
	v := toLocalView(&row)
	return &v, json.RawMessage(row.Content), nil
}

// Update changes the title, description and tags (content is immutable; save a new template to change it).
func (s *LocalTemplateService) Update(id int, title, description string, tags []string) (*LocalTemplateView, error) {
	in := &LocalTemplateInput{Kind: "inbound", Title: title, Description: description, Tags: tags, Content: json.RawMessage(`{}`)}
	if _, nt, err := ValidateLocalTemplate(in); err != nil {
		return nil, err
	} else {
		tags = nt
	}
	tagsJSON, _ := json.Marshal(tags)
	db := database.GetDB()
	res := db.Model(&model.LocalTemplate{}).Where("id = ?", id).Updates(map[string]any{
		"title": in.Title, "description": in.Description, "tags": string(tagsJSON), "updated_at": time.Now().Unix()})
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return nil, ErrLocalTemplateNotFound
	}
	v, _, err := s.Get(id)
	return v, err
}

func (s *LocalTemplateService) Delete(id int) error {
	res := database.GetDB().Delete(&model.LocalTemplate{}, id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrLocalTemplateNotFound
	}
	return nil
}
