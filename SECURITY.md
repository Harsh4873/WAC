# Reporting security problems

For sensitive reports about WAC, contact the course-project publisher at notcillaj@gmail.com.
Include the affected version, reproduction steps using sample data, and the impact you observed.

Do not include live access tokens, model credentials, private keys, real calendar data, or original
assignment documents in public issues or screenshots. Ordinary bugs with non-sensitive examples can
be reported through repository issues.

The analysis server is a local prototype bound to loopback. A public deployment needs authentication
and user-level quotas; browser origin checks are not authentication. See `backend/README.md`.
