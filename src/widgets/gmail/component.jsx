import { useTranslation } from "next-i18next/pages";
import CardBadge from "components/faro/card-badge";
import CardFooterLink from "components/faro/card-footer-link";
import MailList from "components/faro/mail-list";
import Container from "components/services/widget/container";

import useWidgetAPI from "utils/proxy/use-widget-api";

const REFRESH_INTERVAL_MS = 2 * 60 * 1000;

export default function Component({ service }) {
  const { t } = useTranslation();
  const { widget } = service;

  const { data, error } = useWidgetAPI(widget, undefined, undefined, {
    refreshInterval: REFRESH_INTERVAL_MS,
  });

  if (error) {
    return <Container service={service} error={error} />;
  }

  const unreadCount = typeof data?.unread === "number" ? data.unread : null;
  const badgeLabel = unreadCount !== null ? t("faromail.unread", { count: unreadCount }) : null;

  return (
    <>
      {badgeLabel && <CardBadge variant={unreadCount > 0 ? "accent" : "neutral"}>{badgeLabel}</CardBadge>}
      <Container service={service}>
        <div className="flex flex-col w-full">
          <MailList messages={data?.messages} loading={!data} target={service.target} />
          <CardFooterLink
            service={service}
            fallbackHref="https://mail.google.com"
            label={t("faromail.openMail")}
          />
        </div>
      </Container>
    </>
  );
}
