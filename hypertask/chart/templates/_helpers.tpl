{{- define "hypertask.fullname" -}}
{{- default .Release.Name .Values.fullnameOverride | trunc 44 | trimSuffix "-" -}}
{{- end -}}
{{- define "hypertask.labels" -}}
app.kubernetes.io/name: hypertask
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
{{- end -}}
{{- define "hypertask.selector" -}}
app.kubernetes.io/name: hypertask
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
{{- define "hypertask.origin" -}}
{{- printf "https://%s" (required "global.host is required" .Values.global.host) -}}
{{- end -}}
{{- define "hypertask.image" -}}
{{- $image := index .root.Values.images .component -}}
{{- $repository := required (printf "images.%s.repository is required" .component) $image.repository -}}
{{- $prefix := .root.Values.global.imageRegistryPrefix -}}
{{- if and $prefix (not (hasPrefix $prefix $repository)) -}}
{{- fail (printf "Image %s must be mirrored under global.imageRegistryPrefix" .component) -}}
{{- end -}}
{{- if $image.digest -}}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" $image.digest) -}}{{- fail "Image digest must be a SHA-256 digest" -}}{{- end -}}
{{- printf "%s@%s" $repository $image.digest -}}
{{- else -}}
{{- $tag := required (printf "images.%s.tag is required" .component) $image.tag -}}
{{- if or (eq $tag "latest") (contains "REPLACE" $tag) -}}
{{- fail "Run scripts/mirror-images.sh and supply its generated values.images.json; do not deploy placeholder or latest tags" -}}
{{- end -}}
{{- printf "%s:%s" $repository $tag -}}
{{- end -}}
{{- end -}}
{{- define "hypertask.pullSecrets" -}}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
{{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}
