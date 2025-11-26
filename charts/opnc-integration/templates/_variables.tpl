{{/*
---------------------------------------------
Host name of the servers used in the stack.
---------------------------------------------
*/}}

{{- define "opnc.openprojectHost" -}}
{{ .Values.openprojectHost | default "openproject.test" }}
{{- end -}}

{{- define "opnc.openprojectAssetHost" -}}
{{ .Values.openprojectAssetHost | default "openproject-assets.test" }}
{{- end -}}

{{- define "opnc.nextcloudHost" -}}
{{ .Values.nextcloudHost | default "nextcloud.test" }}
{{- end -}}

{{- define "opnc.keycloakHost" -}}
{{ .Values.keycloakHost | default "keycloak.test" }}
{{- end -}}

{{/*
---------------------------------------------
Variables for cert-manager and TLS secrets.
---------------------------------------------
*/}}

{{- define "opnc.issuerName" -}}
opnc-ca-issuer
{{- end -}}

{{- define "opnc.caSecretName" -}}
opnc-ca-secret
{{- end -}}

{{- define "opnc.tlsSecretName" -}}
    {{- if .Values.ingress.existingTlsSecretName }}
        {{- .Values.ingress.existingTlsSecretName -}}
    {{- else }}
        {{- .Values.ingress.tlsSecretName | default "opnc-tls-secret" -}}
    {{- end -}}
{{- end -}}

{{/*
---------------------------------------------
OpenID Connect variables.
---------------------------------------------
*/}}

{{- define "opnc.oidc.providerName" -}}
{{ .Values.oidcProvider.name | default "keycloak" }}
{{- end -}}

{{- define "opnc.oidc.openprojectClientId" -}}
{{ .Values.oidcProvider.openprojectClientId | default "openproject" }}
{{- end -}}

{{- define "opnc.oidc.openprojectClientSecret" -}}
{{ .Values.oidcProvider.openprojectClientSecret | default "openproject-secret" }}
{{- end -}}

{{/*
---------------------------------------------
Volumes
---------------------------------------------
*/}}

{{- define "opnc.volumes.extraVolumes" -}}
{{- if .Values.extraVolumes }}
{{ toYaml .Values.extraVolumes }}
{{- end }}
{{- end -}}

{{- define "opnc.volumes.extraVolumeMounts" -}}
{{- if .Values.extraVolumeMounts }}
{{ toYaml .Values.extraVolumeMounts }}
{{- end }}
{{- end -}}

{{/*
---------------------------------------------
Environment variables
---------------------------------------------
*/}}

{{- define "opnc.extraEnv" -}}
{{- if .Values.extraEnv }}
{{ toYaml .Values.extraEnv }}
{{- end }}
{{- end -}}
