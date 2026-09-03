# Separate Code Sessions from Work Associations

Factory treats each external T3 thread as one durable Code Session and stores its relationships to
Tasks and Subtasks as separate many-to-many Work Associations. Agents may create an association
only after both Factory context and the current running T3 thread resolve uniquely; missing or
ambiguous matches remain unassociated. This preserves sessions that legitimately span several
outcomes or no planned outcome, keeps manual association as a fallback, and prevents external
activity from becoming Factory Work State or human Verification.
